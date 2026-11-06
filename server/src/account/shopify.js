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

/** @param {Record<string, unknown>} oidc @param {string} graphql @returns {Discovery} */
function toDiscovery(oidc, graphql) {
  return {
    issuer: text(oidc, 'issuer'),
    authorization_endpoint: text(oidc, 'authorization_endpoint'),
    token_endpoint: text(oidc, 'token_endpoint'),
    end_session_endpoint: text(oidc, 'end_session_endpoint'),
    jwks_uri: text(oidc, 'jwks_uri'),
    graphql,
  };
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
    // Storefront API don't: find the shop id and use the same addresses.
    const id = await shopId(settings, fetchImpl).catch(() => null);
    if (!id) throw firstRejection(oidc, api);
    const auth = `https://shopify.com/authentication/${id}`;
    const config =
      oidc.status === 'fulfilled'
        ? oidc.value
        : await getJson(fetchImpl, `${auth}/.well-known/openid-configuration`).catch(() => ({
            issuer: auth,
            authorization_endpoint: `${auth}/oauth/authorize`,
            token_endpoint: `${auth}/oauth/token`,
            end_session_endpoint: `${auth}/logout`,
            jwks_uri: `${auth}/.well-known/jwks.json`,
          }));
    const graphql =
      api.status === 'fulfilled'
        ? text(api.value, 'graphql_api')
        : `https://shopify.com/${id}/account/customer/api/${settings.apiVersion}/graphql`;
    value = toDiscovery(config, graphql);
  }
  discoveryCache.set(settings.shopDomain, { value, until: Date.now() + DISCOVERY_TTL_MS });
  return value;
}

/** @type {Map<string, { keys: SigningKey[] }>} */
const jwksCache = new Map();

/**
 * @param {string} part
 * @returns {Record<string, unknown>}
 */
function jwtPart(part) {
  return asRecord(JSON.parse(decoder.decode(fromBase64Url(part))));
}

/**
 * Checks the id token's RS256 signature against Shopify's published keys, then its issuer, audience, nonce and expiry.
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
  const claims = jwtPart(payloadPart);
  if (header['alg'] !== 'RS256') throw new Error(`id token alg ${String(header['alg'])}`);
  let set = jwksCache.get(discovery.jwks_uri);
  if (!set?.keys.some((key) => key.kid === header['kid'])) {
    const response = await fetchImpl(discovery.jwks_uri, { headers: JSON_HEADERS });
    const body = response.ok ? asRecord(await response.json().catch(() => null)) : {};
    const keys = /** @type {unknown} */ (body['keys']);
    if (!Array.isArray(keys)) {
      throw new Error(
        `Shopify's signing keys answered ${response.status} (${response.headers.get('content-type') ?? 'no type'})`,
      );
    }
    /** @type {unknown[]} */
    const entries = keys;
    set = {
      keys: entries
        .filter((key) => key !== null && typeof key === 'object')
        .map((key) => /** @type {SigningKey} */ (key)),
    };
    jwksCache.set(discovery.jwks_uri, set);
  }
  const jwk = set.keys.find((key) => key.kid === header['kid']) ?? (set.keys.length === 1 ? set.keys[0] : undefined);
  if (!jwk) throw new Error('id token key not found');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'verify',
  ]);
  const signed = encoder.encode(`${headerPart}.${payloadPart}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64Url(signature), signed))) {
    throw new Error('id token signature');
  }
  const audience = /** @type {unknown[]} */ ([]).concat(claims['aud'] ?? []);
  if (claims['iss'] !== discovery.issuer) throw new Error('id token issuer');
  if (!audience.includes(settings.clientId)) throw new Error('id token audience');
  if (claims['nonce'] !== nonce) throw new Error('id token nonce');
  if (!(Number(claims['exp']) * 1000 > Date.now())) throw new Error('id token expired');
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
 * @returns {Promise<string | null>} The cart's checkout URL, or `null` when no link was made.
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
  return text(asRecord(update['cart']), 'checkoutUrl') || null;
}
