/**
 * Shopify's side of the browser-mode login: the OAuth and Customer Account API endpoints, found through the shop's
 * `.well-known` documents (a shop with its own accounts domain has other ones), the token endpoint, and the check of
 * the id token it answers with.
 */
import { cfg } from '../config.js';
import { TetherError } from '../client.js';
import { isHttpsUrl } from '../shopify-values.js';
import { fromBase64Url } from '../../server/src/shared/base64url.js';
import { isRecord } from '../../server/src/shared/json.js';
import { accountFetch, readJsonObjectOrEmpty, textOrNull } from './shared.js';

/**
 * @typedef {object} Endpoints
 * @property {string} issuer The id token's `iss`.
 * @property {string} authorizationEndpoint
 * @property {string} tokenEndpoint
 * @property {string} endSessionEndpoint
 * @property {string} graphql The Customer Account API.
 */
/**
 * @typedef {object} TokenAnswer
 * @property {string} access
 * @property {string | null} refresh Left out of some refresh answers.
 * @property {string | null} idToken Left out of refresh answers.
 * @property {number} expiresInSeconds
 */

/** Shopify's access tokens last an hour; an answer without `expires_in` is taken to say so. */
const DEFAULT_TOKEN_SECONDS = 3600;

/** @type {Endpoints | null} */
let endpoints = null;

/**
 * @param {string} document `openid-configuration` or `customer-account-api`.
 * @returns {Promise<Record<string, unknown>>}
 */
async function wellKnown(document) {
  const shop = cfg.account?.shopDomain || cfg.domain;
  const response = await accountFetch(`https://${shop}/.well-known/${document}`);
  if (!response.ok) {
    throw new TetherError(`Customer accounts: ${document} answered ${response.status}`, { status: response.status });
  }
  return readJsonObjectOrEmpty(response);
}

/**
 * @param {Record<string, unknown>} json
 * @param {string} name
 * @returns {string}
 * @throws {TetherError} When Shopify's document lacks the endpoint, or names one that isn't https: the tokens and the
 *   customer's data go there.
 */
function endpointIn(json, name) {
  const url = textOrNull(json[name]);
  if (url === null || !isHttpsUrl(url)) throw new TetherError(`Customer accounts: Shopify named no https ${name}`);
  return url;
}

/**
 * @returns {Promise<Endpoints>} The shop's endpoints, asked once per page.
 * @throws {TetherError} When Shopify's documents can't be read.
 */
export async function discover() {
  if (endpoints) return endpoints;
  const [openid, api] = await Promise.all([wellKnown('openid-configuration'), wellKnown('customer-account-api')]);
  endpoints = {
    issuer: endpointIn(openid, 'issuer'),
    authorizationEndpoint: endpointIn(openid, 'authorization_endpoint'),
    tokenEndpoint: endpointIn(openid, 'token_endpoint'),
    endSessionEndpoint: endpointIn(openid, 'end_session_endpoint'),
    graphql: endpointIn(api, 'graphql_api'),
  };
  return endpoints;
}

/**
 * A token request, as a "simple" request (a form body, no custom header) so the browser sends it without a CORS
 * preflight. `account.tokenUrl` replaces Shopify's endpoint for a browser that can't reach it; it must be the shop's
 * own first-party endpoint passing the form on to Shopify, because the id token in the answer is trusted unsigned
 * (`idTokenClaims`).
 *
 * @param {Record<string, string>} params
 * @returns {Promise<TokenAnswer>}
 * @throws {TetherError} `SESSION_ENDED` when Shopify refuses the code or refresh token (400, 401), else `TOKEN_FAILED`.
 */
export async function requestToken(params) {
  const { tokenEndpoint } = await discover();
  const response = await accountFetch(cfg.account?.tokenUrl || tokenEndpoint, {
    method: 'POST',
    body: new URLSearchParams(params),
  });
  const data = await readJsonObjectOrEmpty(response);
  const access = textOrNull(data['access_token']);
  if (!response.ok || !access) {
    const ended = response.status === 400 || response.status === 401;
    throw new TetherError(`Customer accounts: token ${response.status} ${textOrNull(data['error']) ?? ''}`.trim(), {
      status: response.status,
      code: ended ? 'SESSION_ENDED' : 'TOKEN_FAILED',
    });
  }
  return {
    access,
    refresh: textOrNull(data['refresh_token']) || null,
    idToken: textOrNull(data['id_token']) || null,
    expiresInSeconds: Number(data['expires_in']) || DEFAULT_TOKEN_SECONDS,
  };
}

/**
 * @param {string} payload
 * @returns {unknown} The payload's JSON; `null` for one that isn't base64url JSON, which is no id token.
 */
function decodedJsonOrNull(payload) {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch {
    return null;
  }
}

/**
 * The id token's claims. Its signature isn't checked: the token comes straight from Shopify's token endpoint over
 * TLS, in answer to this browser's own code and verifier, so nobody else could have written it. That holds only while
 * `account.tokenUrl` (when set) is the shop's own first-party endpoint passing the request on to Shopify (see
 * `requestToken`).
 *
 * @param {string} idToken
 * @returns {Record<string, unknown> | null}
 */
function idTokenClaims(idToken) {
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  const claims = decodedJsonOrNull(payload);
  return isRecord(claims) ? claims : null;
}

/**
 * @param {string | null} idToken
 * @param {{ nonce: string, issuer: string, client: string }} expected The login's nonce, Shopify's issuer, our client.
 * @returns {boolean} True when the id token answers this login: the expected claims, and not expired.
 */
export function answersLogin(idToken, { nonce, issuer, client }) {
  const claims = idToken ? idTokenClaims(idToken) : null;
  if (!claims) return false;
  const audience = claims['aud'];
  const audiences = Array.isArray(audience) ? audience : [audience];
  const expiresAt = claims['exp'];
  return (
    claims['nonce'] === nonce &&
    claims['iss'] === issuer &&
    audiences.includes(client) &&
    typeof expiresAt === 'number' &&
    expiresAt * 1000 >= Date.now()
  );
}
