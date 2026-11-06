/**
 * Shopify's side of the browser-mode login: the OAuth and Customer Account API endpoints, found through the shop's
 * `.well-known` documents (a shop with its own accounts domain has other ones), the token endpoint, and the check of
 * the id token it answers with.
 */
import { cfg } from '../config.js';
import { TetherError } from '../client.js';
import { fromBase64Url } from '../../server/src/shared/base64url.js';
import {
  CUSTOMER_ACCOUNT_API,
  DiscoveryError,
  OPENID_CONFIGURATION,
  accountEndpoints,
  graphqlEndpoint,
  wellKnownUrl,
} from '../../server/src/shared/discovery.js';
import { checkIdTokenClaims } from '../../server/src/shared/id-token-claims.js';
import { tokenAnswer, tokenRefusal } from '../../server/src/shared/token-answer.js';
import { accountFetch, readJsonObjectOrEmpty } from './shared.js';
/** @import { AccountEndpoints, DiscoveryDocument } from '../../server/src/shared/discovery.js' */
/** @import { TokenAnswer } from '../../server/src/shared/token-answer.js' */

const MS_PER_SECOND = 1000;

/** @type {{ shop: string, endpoints: AccountEndpoints } | null} The last shop's endpoints, asked once per page. */
let discovered = null;

/** @returns {string} The host whose discovery documents name the shop's account endpoints. */
const accountShop = () => cfg.account?.shopDomain || cfg.domain;

/**
 * @param {string} shop
 * @param {DiscoveryDocument} document
 * @returns {Promise<Record<string, unknown>>}
 */
async function wellKnown(shop, document) {
  const response = await accountFetch(wellKnownUrl(shop, document));
  if (!response.ok) {
    throw new TetherError(`Customer accounts: ${document} answered ${String(response.status)}`, {
      status: response.status,
    });
  }
  return readJsonObjectOrEmpty(response);
}

/**
 * @param {string} shop
 * @returns {Promise<AccountEndpoints>}
 * @throws {TetherError} When Shopify's documents can't be read, lack an endpoint, or name one that isn't https: the
 *   tokens and the customer's data go there.
 */
async function readEndpoints(shop) {
  const [openid, api] = await Promise.all([
    wellKnown(shop, OPENID_CONFIGURATION),
    wellKnown(shop, CUSTOMER_ACCOUNT_API),
  ]);
  try {
    return accountEndpoints(openid, graphqlEndpoint(api));
  } catch (error) {
    if (error instanceof DiscoveryError) throw new TetherError(`Customer accounts: ${error.message}`);
    throw error;
  }
}

/**
 * @returns {Promise<AccountEndpoints>} The shop's endpoints, asked once per page and shop.
 * @throws {TetherError} As `readEndpoints`.
 */
export async function discover() {
  const shop = accountShop();
  if (discovered?.shop !== shop) discovered = { shop, endpoints: await readEndpoints(shop) };
  return discovered.endpoints;
}

/**
 * A token request, as a "simple" request (a form body, no custom header) so the browser sends it without a CORS
 * preflight. `account.tokenUrl` replaces Shopify's endpoint for a browser that can't reach it; it must be the shop's
 * own first-party endpoint passing the form on to Shopify, because the id token in the answer is trusted unsigned
 * (`idTokenClaims`).
 *
 * @param {Record<string, string>} params
 * @returns {Promise<TokenAnswer>}
 * @throws {TetherError} `SESSION_ENDED` when Shopify refuses the grant itself (`invalid_grant`: the code or refresh
 *   token is no longer valid), as the Worker does. Any other refusal or failure is `TOKEN_FAILED`: `invalid_client` or
 *   a wrong `redirect_uri` is a setup error, which must not log every customer out.
 */
export async function requestToken(params) {
  const { tokenEndpoint } = await discover();
  const response = await accountFetch(cfg.account?.tokenUrl || tokenEndpoint, {
    method: 'POST',
    body: new URLSearchParams(params),
  });
  const data = await readJsonObjectOrEmpty(response);
  const answer = response.ok ? tokenAnswer(data) : null;
  if (answer) return answer;
  const refusal = tokenRefusal(data);
  throw new TetherError(`Customer accounts: token ${String(response.status)} ${refusal.code ?? ''}`.trim(), {
    status: response.status,
    code: refusal.kind === 'session-ended' ? 'SESSION_ENDED' : 'TOKEN_FAILED',
  });
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
 * @returns {unknown} The decoded payload; `null` for a token without one.
 */
function idTokenClaims(idToken) {
  const payload = idToken.split('.')[1];
  return payload ? decodedJsonOrNull(payload) : null;
}

/**
 * @param {string | null} idToken
 * @param {{ nonce: string, issuer: string, client: string }} expected The login's nonce, Shopify's issuer, our client.
 * @returns {string | null} Why the id token doesn't answer this login, checked as the Worker checks it; `null` when
 *   it does.
 */
export function loginAnswerProblem(idToken, { nonce, issuer, client }) {
  if (!idToken) return 'no id token';
  const check = checkIdTokenClaims(idTokenClaims(idToken), {
    issuer,
    clientId: client,
    nonce,
    nowSeconds: Date.now() / MS_PER_SECOND,
  });
  return check.kind === 'valid' ? null : check.reason;
}
