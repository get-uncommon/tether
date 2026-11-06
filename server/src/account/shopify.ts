/**
 * The Worker's side of Shopify's Customer Account API: endpoint discovery, the token endpoint, customer queries, and
 * linking a cart to the customer through the Storefront API. The id token's signature is checked in `id-token.ts`.
 */

import type { ShopifyAccountSettings } from './settings.ts';
import type { AccountEndpoints } from './discovery.ts';
import type { TokenAnswer } from './token-answer.ts';
import { CUSTOMER_ACCOUNT_API_VERSION } from '../shared/api-versions.ts';
import {
  accountEndpoints,
  CUSTOMER_ACCOUNT_API,
  graphqlEndpoint,
  OPENID_CONFIGURATION,
  wellKnownUrl,
} from './discovery.ts';
import { textOrNull } from '../shared/json.ts';
import { tokenAnswer, tokenRefusal } from './token-answer.ts';
import { asList, asRecord, responseJsonOrNull } from '../json.ts';

/** Shopify's endpoints for one shop. */
export type Discovery = AccountEndpoints;
export type Fetch = typeof fetch;

/** The token endpoint refused the grant as `invalid_grant`: the login code or refresh token is no longer valid. */
export class SessionEndedError extends Error {}
/** The Customer Account API refused the access token (401): Shopify ended the session. */
export class UnauthorizedError extends Error {}

/** A request to one of Shopify's discovery documents answered with a status other than 2xx. */
class DiscoveryStatusError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** How the Worker names itself to Shopify on every request. */
const USER_AGENT = 'tether-sync (Cloudflare Worker)';
/** Headers of the Worker's GET requests for Shopify's JSON documents (discovery, signing keys). */
export const JSON_HEADERS = { Accept: 'application/json', 'User-Agent': USER_AGENT };
const DISCOVERY_TTL_MS = 3600e3;
/**
 * The statuses with which a store domain's bot protection refuses a Worker: 403, and Shopify's own 430 ("security
 * rejection"). Only these send discovery to Shopify's account host instead.
 */
const BOT_PROTECTION_STATUSES = new Set([403, 430]);

const discoveryCache = new Map<string, { value: Discovery; until: number }>();

/**
 * @throws {DiscoveryStatusError} When the answer isn't 2xx.
 */
async function getJson(fetchImpl: Fetch, url: string): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, { headers: JSON_HEADERS });
  if (!response.ok) {
    throw new DiscoveryStatusError(
      `${url.replace(/^https:\/\/[^/]+/, '')} answered ${response.status}`,
      response.status,
    );
  }
  return asRecord(await responseJsonOrNull(response));
}

/** The shop's numeric id, from the Storefront API (`gid://shopify/Shop/123` → `123`). */
async function shopId(settings: ShopifyAccountSettings, fetchImpl: Fetch): Promise<string | null> {
  if (!settings.storefrontToken) return null;
  const response = await fetchImpl(`https://${settings.shopDomain}/api/${settings.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': settings.storefrontToken },
    body: JSON.stringify({ query: '{ shop { id } }' }),
  });
  if (!response.ok) return null;
  const shop = asRecord(asRecord(asRecord(await responseJsonOrNull(response))['data'])['shop']);
  return textOrNull(shop['id'])?.split('/').pop() || null;
}

/**
 * The reason of the first rejected result, rethrown unless it is the store domain's bot protection.
 *
 * @throws {unknown} Any other failure: DNS, a 5xx, an answer that isn't JSON.
 */
function throwUnlessBotProtection(...results: PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status === 'fulfilled') continue;
    const reason: unknown = result.reason;
    if (!(reason instanceof DiscoveryStatusError && BOT_PROTECTION_STATUSES.has(reason.status))) throw reason;
  }
}

/**
 * The endpoints from Shopify's account host, for a store domain that refuses Workers. The store domain's own answer
 * is used where it gave one.
 */
async function discoverByShopId(
  settings: ShopifyAccountSettings,
  fetchImpl: Fetch,
  oidc: PromiseSettledResult<Record<string, unknown>>,
  api: PromiseSettledResult<Record<string, unknown>>,
): Promise<Discovery> {
  throwUnlessBotProtection(oidc, api);
  const id = await shopId(settings, fetchImpl);
  if (!id) throw new Error('the store domain refused discovery, and the shop id is unknown without STOREFRONT_TOKEN');
  const config =
    oidc.status === 'fulfilled'
      ? oidc.value
      : await getJson(fetchImpl, `https://shopify.com/authentication/${id}/.well-known/${OPENID_CONFIGURATION}`);
  const graphql =
    api.status === 'fulfilled'
      ? graphqlEndpoint(api.value)
      : `https://shopify.com/${id}/account/customer/api/${CUSTOMER_ACCOUNT_API_VERSION}/graphql`;
  return accountEndpoints(config, graphql);
}

/** Shopify's account endpoints for the shop, cached for an hour. */
export async function discover(settings: ShopifyAccountSettings, fetchImpl: Fetch): Promise<Discovery> {
  const hit = discoveryCache.get(settings.shopDomain);
  if (hit && hit.until > Date.now()) return hit.value;
  const [oidc, api] = await Promise.allSettled([
    getJson(fetchImpl, wellKnownUrl(settings.shopDomain, OPENID_CONFIGURATION)),
    getJson(fetchImpl, wellKnownUrl(settings.shopDomain, CUSTOMER_ACCOUNT_API)),
  ]);
  // The store domain's bot protection can refuse requests from Workers. Shopify's account host and the Storefront
  // API don't: the shop id finds the endpoints there. Its answer is the only other source: an endpoint or issuer is
  // never guessed.
  const value =
    oidc.status === 'fulfilled' && api.status === 'fulfilled'
      ? accountEndpoints(oidc.value, graphqlEndpoint(api.value))
      : await discoverByShopId(settings, fetchImpl, oidc, api);
  discoveryCache.set(settings.shopDomain, { value, until: Date.now() + DISCOVERY_TTL_MS });
  return value;
}

/**
 * A grant at Shopify's token endpoint.
 *
 * @param params The grant's own parameters.
 * @param origin The site's origin, which Shopify checks for a public client.
 * @throws {SessionEndedError} When Shopify refuses the grant itself (`invalid_grant`).
 * @throws {Error} For any other refusal, such as `invalid_client` or a wrong `redirect_uri`: a setup error, which
 *   must not log the customer out.
 */
export async function tokenRequest(
  settings: ShopifyAccountSettings,
  discovery: Discovery,
  params: Record<string, string>,
  origin: string,
  fetchImpl: Fetch,
): Promise<TokenAnswer> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: origin,
    'User-Agent': USER_AGENT,
  };
  if (settings.clientSecret)
    headers['Authorization'] = `Basic ${btoa(`${settings.clientId}:${settings.clientSecret}`)}`;
  const response = await fetchImpl(discovery.tokenEndpoint, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ client_id: settings.clientId, ...params }),
  });
  const data = await responseJsonOrNull(response);
  const answer = response.ok ? tokenAnswer(data) : null;
  if (answer) return answer;
  const refusal = tokenRefusal(data);
  const message = `token ${response.status} ${refusal.code ?? ''}`.trim();
  if (refusal.kind === 'session-ended') throw new SessionEndedError(message);
  throw new Error(message);
}

/** The `message` of each GraphQL error or user error, joined. */
function messagesOf(problems: unknown[]): string {
  return problems.map((problem) => textOrNull(asRecord(problem)['message']) ?? '').join(' | ');
}

/**
 * One Customer Account API document with the customer's access token.
 *
 * @returns The `data` of the answer.
 * @throws {UnauthorizedError} When Shopify refuses the token.
 */
export async function customerQuery(
  discovery: Discovery,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  origin: string,
  fetchImpl: Fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(discovery.graphql, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken,
      Origin: origin,
      'User-Agent': USER_AGENT,
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
 * @returns The cart's checkout URL; `null` without a Storefront token or cart.
 * @throws {Error} When Shopify refuses the change.
 */
export async function linkCart(
  settings: ShopifyAccountSettings,
  cartId: string,
  accessToken: string | null,
  fetchImpl: Fetch,
): Promise<string | null> {
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
  return textOrNull(asRecord(update['cart'])['checkoutUrl']);
}
