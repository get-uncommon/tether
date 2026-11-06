/**
 * The Worker's side of Shopify's Customer Account API: endpoint discovery, the token endpoint, the id token's signature,
 * customer queries, and linking a cart to the customer through the Storefront API.
 */

/** @import { AccountSettings } from './settings.js' */

import { fromBase64Url } from '../shared/base64url.js';

/**
 * Shopify's endpoints for one shop.
 *
 * @typedef {object} Discovery
 * @property {string} issuer
 * @property {string} authorization_endpoint
 * @property {string} token_endpoint
 * @property {string} end_session_endpoint
 * @property {string} jwks_uri
 * @property {string} graphql The Customer Account API GraphQL endpoint.
 */

/**
 * What Shopify's token endpoint answers.
 *
 * @typedef {{ access_token: string, refresh_token?: string, id_token?: string, expires_in?: number | string }} TokenSet
 */

/** @typedef {typeof fetch} Fetch */
/** @typedef {JsonWebKey & { kid?: string }} SigningKey A JWK from Shopify's key set. */

/** The token endpoint refused the grant (400/401): the login or refresh token is no longer valid. */
export class SessionEndedError extends Error {}
/** The Customer Account API refused the access token (401): Shopify ended the session. */
export class UnauthorizedError extends Error {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const JSON_HEADERS = { Accept: 'application/json', 'User-Agent': 'tether-sync (Cloudflare Worker)' };
const DISCOVERY_TTL_MS = 3600e3;

/** @type {Map<string, { value: Discovery, until: number }>} */
const discoveryCache = new Map();

/** @param {unknown} value @returns {Record<string, unknown>} */
function asRecord(value) {
  return value !== null && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** @param {Record<string, unknown>} record @param {string} key */
function text(record, key) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/**
 * @param {Fetch} fetchImpl
 * @param {string} url
 * @returns {Promise<Record<string, unknown>>}
 */
async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: JSON_HEADERS });
  if (!response.ok) throw new Error(`${url.replace(/^https:\/\/[^/]+/, '')} answered ${response.status}`);
  return asRecord(await response.json());
}

/**
 * @param {Record<string, unknown>} oidc
 * @param {string} graphql
 * @returns {Discovery}
 * @throws {Error} When an endpoint is missing or isn't https.
 */
function toDiscovery(oidc, graphql) {
  const discovery = {
    issuer: text(oidc, 'issuer'),
    authorization_endpoint: text(oidc, 'authorization_endpoint'),
    token_endpoint: text(oidc, 'token_endpoint'),
    end_session_endpoint: text(oidc, 'end_session_endpoint'),
    jwks_uri: text(oidc, 'jwks_uri'),
    graphql,
  };
  for (const [name, value] of Object.entries(discovery)) {
    if (!value.startsWith('https://')) throw new Error(`Shopify's account discovery has no https ${name}`);
  }
  return discovery;
}

/**
 * The shop's numeric id, from the Storefront API (`gid://shopify/Shop/123` → `123`).
 *
 * @param {AccountSettings} settings
 * @param {Fetch} fetchImpl
 */
async function shopId(settings, fetchImpl) {
  if (!settings.storefrontToken) return null;
  const response = await fetchImpl(`https://${settings.shopDomain}/api/${settings.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': settings.storefrontToken },
    body: JSON.stringify({ query: '{ shop { id } }' }),
  });
  if (!response.ok) return null;
  const shop = asRecord(asRecord(asRecord(await response.json())['data'])['shop']);
  return text(shop, 'id').split('/').pop() || null;
}

/**
 * The reason of the first rejected result.
 *
 * @param {...PromiseSettledResult<unknown>} results
 * @returns {unknown}
 */
function firstRejection(...results) {
  return results.find((result) => result.status === 'rejected')?.reason;
}

/**
 * Shopify's account endpoints for the shop, cached for an hour.
 *
 * @param {AccountSettings} settings
 * @param {Fetch} fetchImpl
 * @returns {Promise<Discovery>}
 */
export async function discover(settings, fetchImpl) {
  const hit = discoveryCache.get(settings.shopDomain);
  if (hit && hit.until > Date.now()) return hit.value;
  const [oidc, api] = await Promise.allSettled([
    getJson(fetchImpl, `https://${settings.shopDomain}/.well-known/openid-configuration`),
    getJson(fetchImpl, `https://${settings.shopDomain}/.well-known/customer-account-api`),
  ]);
  /** @type {Discovery} */
  let value;
  if (oidc.status === 'fulfilled' && api.status === 'fulfilled') {
    value = toDiscovery(oidc.value, text(api.value, 'graphql_api'));
  } else {
    // The store domain's bot protection can refuse requests from Workers (403). Shopify's account host and the
    // Storefront API don't: find the shop id and ask Shopify's account host instead. Its answer is the only other
    // source: an endpoint or issuer is never guessed.
    const storeDomainError = firstRejection(oidc, api);
    const id = await shopId(settings, fetchImpl);
    if (!id) throw storeDomainError;
    const config =
      oidc.status === 'fulfilled'
        ? oidc.value
        : await getJson(fetchImpl, `https://shopify.com/authentication/${id}/.well-known/openid-configuration`);
    const graphql =
      api.status === 'fulfilled'
        ? text(api.value, 'graphql_api')
        : `https://shopify.com/${id}/account/customer/api/${settings.apiVersion}/graphql`;
    value = toDiscovery(config, graphql);
  }
  discoveryCache.set(settings.shopDomain, { value, until: Date.now() + DISCOVERY_TTL_MS });
  return value;
}

/** How long Shopify's signing keys are trusted before they are fetched again. */
const JWKS_TTL_MS = 3600e3;
/** Clock difference allowed between Shopify and the Worker for `iat` and `nbf`. */
const CLOCK_SKEW_SECONDS = 300;

/** @type {Map<string, { keys: SigningKey[], until: number }>} */
const jwksCache = new Map();

/**
 * @param {string} part
 * @returns {Record<string, unknown>}
 */
function jwtPart(part) {
  return asRecord(JSON.parse(decoder.decode(fromBase64Url(part))));
}

/**
 * Shopify's signing keys, fetched again after {@link JWKS_TTL_MS} or when a token names a key they don't have.
 *
 * @param {string} jwksUri
 * @param {string} kid
 * @param {Fetch} fetchImpl
 * @returns {Promise<SigningKey[]>}
 */
async function signingKeys(jwksUri, kid, fetchImpl) {
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.until > Date.now() && cached.keys.some((key) => key.kid === kid)) return cached.keys;
  const response = await fetchImpl(jwksUri, { headers: JSON_HEADERS });
  const body = response.ok ? asRecord(await response.json().catch(() => null)) : {};
  const keys = /** @type {unknown} */ (body['keys']);
  if (!Array.isArray(keys)) {
    const type = response.headers.get('content-type') ?? 'no type';
    throw new Error(`Shopify's signing keys answered ${response.status} (${type})`);
  }
  /** @type {unknown[]} */
  const entries = keys;
  const parsed = entries
    .filter((key) => key !== null && typeof key === 'object')
    .map((key) => /** @type {SigningKey} */ (key));
  jwksCache.set(jwksUri, { keys: parsed, until: Date.now() + JWKS_TTL_MS });
  return parsed;
}

/**
 * Checks the id token's RS256 signature against Shopify's published key with the token's `kid`, and only then its
 * claims: issuer, audience, nonce, expiry, and that it was issued and valid by now.
 *
 * @param {string | undefined} token
 * @param {Discovery} discovery
 * @param {AccountSettings} settings
 * @param {string} nonce The nonce sent with this login.
 * @param {Fetch} fetchImpl
 */
export async function verifyIdToken(token, discovery, settings, nonce, fetchImpl) {
  const [headerPart, payloadPart, signature] = (token ?? '').split('.');
  if (!headerPart || !payloadPart || !signature) throw new Error('id token missing');
  const header = jwtPart(headerPart);
  if (header['alg'] !== 'RS256') throw new Error(`id token alg ${String(header['alg'])}`);
  const kid = header['kid'];
  if (typeof kid !== 'string' || !kid) throw new Error('id token has no key id');
  const jwk = (await signingKeys(discovery.jwks_uri, kid, fetchImpl)).find((key) => key.kid === kid);
  if (!jwk) throw new Error('id token key not found');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'verify',
  ]);
  const signed = encoder.encode(`${headerPart}.${payloadPart}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64Url(signature), signed))) {
    throw new Error('id token signature');
  }
  const claims = jwtPart(payloadPart);
  const now = Date.now() / 1000;
  const audience = /** @type {unknown[]} */ ([]).concat(claims['aud'] ?? []);
  if (claims['iss'] !== discovery.issuer) throw new Error('id token issuer');
  if (!audience.includes(settings.clientId)) throw new Error('id token audience');
  if (claims['nonce'] !== nonce) throw new Error('id token nonce');
  if (!(Number(claims['exp']) > now)) throw new Error('id token expired');
  if (Number(claims['iat'] ?? 0) > now + CLOCK_SKEW_SECONDS) throw new Error('id token issued in the future');
  if (Number(claims['nbf'] ?? 0) > now + CLOCK_SKEW_SECONDS) throw new Error('id token not valid yet');
  return claims;
}

/**
 * A grant at Shopify's token endpoint.
 *
 * @param {AccountSettings} settings
 * @param {Discovery} discovery
 * @param {Record<string, string>} params The grant's own parameters.
 * @param {string} origin The site's origin, which Shopify checks for a public client.
 * @param {Fetch} fetchImpl
 * @returns {Promise<TokenSet>}
 * @throws {SessionEndedError} When Shopify refuses the grant.
 */
export async function tokenRequest(settings, discovery, params, origin, fetchImpl) {
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, 'User-Agent': 'tether-sync' };
  if (settings.clientSecret)
    headers['Authorization'] = `Basic ${btoa(`${settings.clientId}:${settings.clientSecret}`)}`;
  const response = await fetchImpl(discovery.token_endpoint, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ client_id: settings.clientId, ...params }),
  });
  const data = asRecord(await response.json().catch(() => ({})));
  const accessToken = text(data, 'access_token');
  if (!response.ok || !accessToken) {
    const message = `token ${response.status} ${text(data, 'error')}`.trim();
    if (response.status === 400 || response.status === 401) throw new SessionEndedError(message);
    throw new Error(message);
  }
  return { ...data, access_token: accessToken };
}

/**
 * One Customer Account API document with the customer's access token.
 *
 * @param {Discovery} discovery
 * @param {string} accessToken
 * @param {string} query
 * @param {Record<string, unknown>} variables
 * @param {string} origin
 * @param {Fetch} fetchImpl
 * @returns {Promise<Record<string, unknown>>} The `data` of the answer.
 * @throws {UnauthorizedError} When Shopify refuses the token.
 */
export async function customerQuery(discovery, accessToken, query, variables, origin, fetchImpl) {
  const response = await fetchImpl(discovery.graphql, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken,
      Origin: origin,
      'User-Agent': 'tether-sync',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = asRecord(await response.json().catch(() => ({})));
  if (response.status === 401) throw new UnauthorizedError('unauthorized');
  const errors = Array.isArray(body['errors']) ? /** @type {unknown[]} */ (body['errors']) : [];
  if (!response.ok || errors.length) {
    const messages = errors.map((error) => text(asRecord(error), 'message')).join(' | ');
    throw new Error(messages || `customer api ${response.status}`);
  }
  return asRecord(body['data']);
}

const CART_LINK = `mutation L($id: ID!, $b: CartBuyerIdentityInput!) {
  cartBuyerIdentityUpdate(cartId: $id, buyerIdentity: $b) { cart { checkoutUrl } userErrors { message } }
}`;

/**
 * Links the cart to the customer (or unlinks it, with `accessToken` null), so checkout knows them.
 *
 * @param {AccountSettings} settings
 * @param {string} cartId
 * @param {string | null} accessToken
 * @param {Fetch} fetchImpl
 * @returns {Promise<string | null>} The cart's checkout URL; `null` without a Storefront token or cart.
 * @throws {Error} When Shopify refuses the change.
 */
export async function linkCart(settings, cartId, accessToken, fetchImpl) {
  if (!settings.storefrontToken || !cartId) return null;
  const response = await fetchImpl(`https://${settings.shopDomain}/api/${settings.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': settings.storefrontToken },
    body: JSON.stringify({ query: CART_LINK, variables: { id: cartId, b: { customerAccessToken: accessToken } } }),
  });
  const body = asRecord(await response.json().catch(() => ({})));
  const update = asRecord(asRecord(body['data'])['cartBuyerIdentityUpdate']);
  const problems = [body['errors'], update['userErrors']].flatMap((list) =>
    Array.isArray(list) ? /** @type {unknown[]} */ (list) : [],
  );
  if (!response.ok || problems.length) {
    const messages = problems.map((problem) => text(asRecord(problem), 'message')).join(' | ');
    throw new Error(`cart link ${response.status} ${messages}`.trim());
  }
  return text(asRecord(update['cart']), 'checkoutUrl') || null;
}
