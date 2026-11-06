/**
 * The Worker's side of Shopify's Customer Account API: endpoint discovery, the token endpoint, customer queries, and
 * linking a cart to the customer through the Storefront API. The id token's signature is checked in `id-token.js`.
 */

/** @import { AccountSettings } from './settings.js' */

import { CUSTOMER_ACCOUNT_API_VERSION } from '../shared/api-versions.js';
import { asList, asRecord, responseJsonOrNull } from '../json.js';

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
 * What Shopify's token endpoint answers, parsed: a field Shopify left out or sent with the wrong type is `null`.
 *
 * @typedef {object} TokenSet
 * @property {string} access_token
 * @property {string | null} refresh_token
 * @property {string | null} id_token
 * @property {number | null} expires_in Seconds.
 */

/** @typedef {typeof fetch} Fetch */

/** The token endpoint refused the grant as `invalid_grant`: the login code or refresh token is no longer valid. */
export class SessionEndedError extends Error {}
/** The Customer Account API refused the access token (401): Shopify ended the session. */
export class UnauthorizedError extends Error {}

/** A request to one of Shopify's discovery documents answered with a status other than 2xx. */
class DiscoveryStatusError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const JSON_HEADERS = { Accept: 'application/json', 'User-Agent': 'tether-sync (Cloudflare Worker)' };
const DISCOVERY_TTL_MS = 3600e3;
/**
 * The statuses with which a store domain's bot protection refuses a Worker: 403, and Shopify's own 430 ("security
 * rejection"). Only these send discovery to Shopify's account host instead.
 */
const BOT_PROTECTION_STATUSES = new Set([403, 430]);

/** @type {Map<string, { value: Discovery, until: number }>} */
const discoveryCache = new Map();

/** @param {Record<string, unknown>} record @param {string} key */
function text(record, key) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/** @param {Record<string, unknown>} record @param {string} key */
function textOrNull(record, key) {
  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

/**
 * @param {Fetch} fetchImpl
 * @param {string} url
 * @returns {Promise<Record<string, unknown>>}
 * @throws {DiscoveryStatusError} When the answer isn't 2xx.
 */
async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: JSON_HEADERS });
  if (!response.ok) {
    throw new DiscoveryStatusError(
      `${url.replace(/^https:\/\/[^/]+/, '')} answered ${response.status}`,
      response.status,
    );
  }
  return asRecord(await responseJsonOrNull(response));
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
  const shop = asRecord(asRecord(asRecord(await responseJsonOrNull(response))['data'])['shop']);
  return text(shop, 'id').split('/').pop() || null;
}

/**
 * The reason of the first rejected result, rethrown unless it is the store domain's bot protection.
 *
 * @param {...PromiseSettledResult<unknown>} results
 * @throws {unknown} Any other failure: DNS, a 5xx, an answer that isn't JSON.
 */
function throwUnlessBotProtection(...results) {
  for (const result of results) {
    if (result.status === 'fulfilled') continue;
    /** @type {unknown} */
    const reason = result.reason;
    if (!(reason instanceof DiscoveryStatusError && BOT_PROTECTION_STATUSES.has(reason.status))) throw reason;
  }
}

/**
 * The endpoints from Shopify's account host, for a store domain that refuses Workers. The store domain's own answer
 * is used where it gave one.
 *
 * @param {AccountSettings} settings
 * @param {Fetch} fetchImpl
 * @param {PromiseSettledResult<Record<string, unknown>>} oidc
 * @param {PromiseSettledResult<Record<string, unknown>>} api
 * @returns {Promise<Discovery>}
 */
async function discoverByShopId(settings, fetchImpl, oidc, api) {
  throwUnlessBotProtection(oidc, api);
  const id = await shopId(settings, fetchImpl);
  if (!id) throw new Error('the store domain refused discovery, and the shop id is unknown without STOREFRONT_TOKEN');
  const config =
    oidc.status === 'fulfilled'
      ? oidc.value
      : await getJson(fetchImpl, `https://shopify.com/authentication/${id}/.well-known/openid-configuration`);
  const graphql =
    api.status === 'fulfilled'
      ? text(api.value, 'graphql_api')
      : `https://shopify.com/${id}/account/customer/api/${CUSTOMER_ACCOUNT_API_VERSION}/graphql`;
  return toDiscovery(config, graphql);
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
  // The store domain's bot protection can refuse requests from Workers. Shopify's account host and the Storefront
  // API don't: the shop id finds the endpoints there. Its answer is the only other source: an endpoint or issuer is
  // never guessed.
  const value =
    oidc.status === 'fulfilled' && api.status === 'fulfilled'
      ? toDiscovery(oidc.value, text(api.value, 'graphql_api'))
      : await discoverByShopId(settings, fetchImpl, oidc, api);
  discoveryCache.set(settings.shopDomain, { value, until: Date.now() + DISCOVERY_TTL_MS });
  return value;
}

/**
 * Shopify's `expires_in`, which arrives as a number or a numeric string.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function secondsOrNull(value) {
  const seconds = typeof value === 'string' ? Number(value) : value;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
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
 * @throws {SessionEndedError} When Shopify refuses the grant itself (`invalid_grant`).
 * @throws {Error} For any other refusal, such as `invalid_client` or a wrong `redirect_uri`: a setup error, which
 *   must not log the customer out.
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
  const data = asRecord(await responseJsonOrNull(response));
  const accessToken = textOrNull(data, 'access_token');
  if (!response.ok || !accessToken) {
    const code = text(data, 'error');
    const message = `token ${response.status} ${code}`.trim();
    if (code === 'invalid_grant') throw new SessionEndedError(message);
    throw new Error(message);
  }
  return {
    access_token: accessToken,
    refresh_token: textOrNull(data, 'refresh_token'),
    id_token: textOrNull(data, 'id_token'),
    expires_in: secondsOrNull(data['expires_in']),
  };
}

/**
 * The `message` of each GraphQL error or user error, joined.
 *
 * @param {unknown[]} problems
 */
function messagesOf(problems) {
  return problems.map((problem) => text(asRecord(problem), 'message')).join(' | ');
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
  const body = asRecord(await responseJsonOrNull(response));
  if (response.status === 401) throw new UnauthorizedError('unauthorized');
  const errors = asList(body['errors']);
  if (!response.ok || errors.length) throw new Error(messagesOf(errors) || `customer api ${response.status}`);
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
  const body = asRecord(await responseJsonOrNull(response));
  const update = asRecord(asRecord(body['data'])['cartBuyerIdentityUpdate']);
  const problems = [...asList(body['errors']), ...asList(update['userErrors'])];
  if (!response.ok || problems.length) throw new Error(`cart link ${response.status} ${messagesOf(problems)}`.trim());
  return text(asRecord(update['cart']), 'checkoutUrl') || null;
}
