/**
 * Shopify Admin GraphQL client (read-only: products).
 *
 * Auth, either:
 *   - adminToken: a static Admin API token (shpat_...) from an existing custom app, or
 *   - clientId + clientSecret: a Dev Dashboard app installed on your own store. Tokens come
 *     from the client credentials grant, last ~24h and are refreshed automatically.
 * Scope needed: read_products (add read_inventory if you map inventory).
 */
import { ADMIN_API_VERSION } from './shared/api-versions.js';
import { SyncError, sleep as realSleep } from './util.js';
import { asList, asRecord, responseJsonOrNull, stringOrNull } from './json.js';
import { tokenSource } from './shopify-token.js';
import { normalizeProduct } from './product.js';

export { normalizeProduct };

/** @typedef {import('./product.js').Product} Product */
/** @typedef {import('./store.js').Store} Store */
/** @typedef {typeof fetch} Fetch */

/** The Admin API version the sync reads products with, unless the config names another. */
export const DEFAULT_API_VERSION = ADMIN_API_VERSION;

const DEFAULT_VARIANTS_FIRST = 25;
const DEFAULT_MEDIA_FIRST = 10;
/** Shopify's limit is 1,000 cost points a query; the rest is headroom for the connection and page info. */
const PAGE_COST_BUDGET = 800;
/** A product node's cost on top of its variants, media and metafields. */
const PRODUCT_BASE_COST = 6;
const MAX_PAGE_SIZE = 50;
const RETRY_BASE_MS = 1000;

/**
 * Shopify rejects a query above 1,000 cost points. A product node costs roughly
 * 1 + variantsFirst + mediaFirst + its other fields, so a page holds ~800 / that.
 *
 * @param {{ variantsFirst?: number, mediaFirst?: number, metafields?: string[] }} [options]
 */
export function pageSizeFor({
  variantsFirst = DEFAULT_VARIANTS_FIRST,
  mediaFirst = DEFAULT_MEDIA_FIRST,
  metafields = [],
} = {}) {
  const perProduct = PRODUCT_BASE_COST + variantsFirst + mediaFirst + metafields.length;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(PAGE_COST_BUDGET / perProduct)));
}

/**
 * The `TetherSyncProduct` fragment {@link normalizeProduct} parses. Metafields are aliased `mf0`, `mf1`... in the
 * order of `metafields`.
 *
 * @param {{ metafields?: string[], inventory?: boolean, mediaFirst?: number, variantsFirst?: number }} [options]
 */
export function productFragment({
  metafields = [],
  inventory = false,
  mediaFirst = DEFAULT_MEDIA_FIRST,
  variantsFirst = DEFAULT_VARIANTS_FIRST,
} = {}) {
  const metafieldSelections = metafields
    .map((ref, index) => {
      const [namespace = '', ...rest] = ref.split('.');
      return `mf${String(index)}: metafield(namespace: ${JSON.stringify(namespace)}, key: ${JSON.stringify(rest.join('.'))}) { value type }`;
    })
    .join('\n  ');
  const totalInventory = inventory ? ' totalInventory' : '';
  const inventoryQuantity = inventory ? ' inventoryQuantity' : '';
  return `fragment TetherSyncProduct on Product {
  id legacyResourceId handle title description descriptionHtml vendor productType tags status
  createdAt updatedAt publishedAt onlineStoreUrl${totalInventory}
  seo { title description }
  priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
  compareAtPriceRange { minVariantCompareAtPrice { amount currencyCode } maxVariantCompareAtPrice { amount currencyCode } }
  featuredMedia { preview { image { url altText } } }
  media(first: ${String(mediaFirst)}) { nodes { mediaContentType preview { image { url altText } } } }
  options { name optionValues { name } }
  variants(first: ${String(variantsFirst)}) { nodes { id legacyResourceId title sku price compareAtPrice availableForSale${inventoryQuantity} } }
  ${metafieldSelections}
}`;
}

/**
 * @typedef {object} ShopifyOptions
 * @property {string | undefined} domain The `.myshopify.com` domain; a scheme or path is stripped.
 * @property {string | undefined} [adminToken]
 * @property {string | undefined} [clientId]
 * @property {string | undefined} [clientSecret]
 * @property {string | undefined} [apiVersion]
 * @property {string[] | undefined} [metafields] `namespace.key` refs fetched with every product.
 * @property {boolean | undefined} [inventory]
 * @property {Fetch | undefined} [fetch]
 * @property {((ms: number) => Promise<void>) | undefined} [sleep]
 * @property {(() => number) | undefined} [now]
 * @property {number | undefined} [retries] Retries after a 429, a 5xx or a THROTTLED error.
 * @property {number | undefined} [variantsFirst]
 * @property {number | undefined} [mediaFirst]
 * @property {Store | null | undefined} [tokenStore] Caches the client-credentials token: one token request a day
 *   instead of one per run.
 */

/** @typedef {{ hasNextPage: boolean, endCursor: string | null }} PageInfo */
/** @typedef {{ id: string, topic: string, uri: string }} WebhookSubscription */

/** @typedef {{ message: string, code: string | undefined }} GraphqlError */

/**
 * @param {unknown} errors The `errors` field of a GraphQL answer.
 * @returns {GraphqlError[]}
 */
function parseGraphqlErrors(errors) {
  return asList(errors).map((error) => {
    const { message, extensions } = asRecord(error);
    const code = stringOrNull(asRecord(extensions)['code']) ?? undefined;
    return { message: stringOrNull(message) ?? 'unknown error', code };
  });
}

/** @typedef {(query: string, variables?: Record<string, unknown>) => Promise<Record<string, unknown>>} Gql */

/** @param {ShopifyOptions} options */
export function createShopify(options) {
  const {
    domain,
    apiVersion = DEFAULT_API_VERSION,
    metafields = [],
    inventory = false,
    fetch: fetchImpl = globalThis.fetch,
    sleep = realSleep,
    now = () => Date.now(),
    retries = 3,
    variantsFirst = DEFAULT_VARIANTS_FIRST,
    mediaFirst = DEFAULT_MEDIA_FIRST,
    tokenStore = null,
  } = options;
  if (!domain) throw new SyncError('shopify.domain is required');
  const shop = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const tokens = tokenSource(options, { shop, fetchImpl, now, tokenStore });

  /** @param {number} attempt */
  const backOff = (attempt) => sleep(RETRY_BASE_MS * 2 ** attempt);

  /** @type {Gql} */
  async function gql(query, variables = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await tokens.current() },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 401 && tokens.replace && attempt < 1) {
        await tokens.replace();
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await backOff(attempt);
        continue;
      }
      const json = asRecord(await responseJsonOrNull(res));
      if (!res.ok) throw new SyncError(`Shopify Admin API ${String(res.status)}`, { status: res.status, body: json });
      const errors = parseGraphqlErrors(json['errors']);
      if (errors.length) {
        if (errors.some((error) => error.code === 'THROTTLED') && attempt < retries) {
          await backOff(attempt);
          continue;
        }
        throw new SyncError(`Shopify Admin API: ${errors.map((error) => error.message).join(' | ')}`, {
          body: json,
          code: errors.find((error) => error.code)?.code,
        });
      }
      return asRecord(json['data']);
    }
  }

  return shopifyClient(gql, { shop, apiVersion, metafields, inventory, variantsFirst, mediaFirst });
}

/**
 * @param {unknown} raw
 * @returns {WebhookSubscription}
 */
function parseWebhook(raw) {
  const { id, topic, uri } = asRecord(raw);
  return { id: stringOrNull(id) ?? '', topic: stringOrNull(topic) ?? '', uri: stringOrNull(uri) ?? '' };
}

/**
 * @param {unknown} raw
 * @returns {PageInfo}
 */
function parsePageInfo(raw) {
  const { hasNextPage, endCursor } = asRecord(raw);
  return { hasNextPage: hasNextPage === true, endCursor: stringOrNull(endCursor) };
}

/** @param {unknown} error */
function costTooHigh(error) {
  return error instanceof SyncError && error.code === 'MAX_COST_EXCEEDED';
}

/**
 * The queries the sync and the setup check send, on top of `gql`.
 *
 * @param {Gql} gql
 * @param {{ shop: string, apiVersion: string, metafields: string[], inventory: boolean, variantsFirst: number,
 *   mediaFirst: number }} settings
 */
function shopifyClient(gql, { shop, apiVersion, metafields, inventory, variantsFirst, mediaFirst }) {
  const fragment = productFragment({ metafields, inventory, variantsFirst, mediaFirst });
  let pageSize = pageSizeFor({ variantsFirst, mediaFirst, metafields });

  /**
   * @param {number} first
   * @param {string | null} after
   * @param {string | null} query
   * @returns {Promise<{ products: Product[], pageInfo: PageInfo }>}
   */
  async function listPage(first, after, query) {
    const data = await gql(
      `query TetherSyncProducts($first: Int!, $after: String, $query: String) {
  products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    nodes { ...TetherSyncProduct }
    pageInfo { hasNextPage endCursor }
  }
}
${fragment}`,
      { first, after, query },
    );
    const products = asRecord(data['products']);
    return {
      products: asList(products['nodes']).map((node) => normalizeProduct(node, metafields)),
      pageInfo: parsePageInfo(products['pageInfo']),
    };
  }

  return {
    shop,
    apiVersion,
    gql,

    /**
     * @param {string} gid
     * @returns {Promise<Product | null>} `null` when the store has no such product.
     */
    async getProduct(gid) {
      const data = await gql(
        `query TetherSyncGetProduct($id: ID!) { product(id: $id) { ...TetherSyncProduct } }\n${fragment}`,
        { id: gid },
      );
      return data['product'] ? normalizeProduct(data['product'], metafields) : null;
    },

    get pageSize() {
      return pageSize;
    },

    /**
     * One page of products, oldest update first. Shrinks the page if Shopify says it costs too much.
     *
     * @param {{ first?: number | undefined, after?: string | null | undefined, query?: string | null | undefined }} [options]
     */
    async listProducts({ first, after = null, query = null } = {}) {
      let size = first ?? pageSize;
      for (;;) {
        try {
          return await listPage(size, after, query);
        } catch (err) {
          if (!costTooHigh(err) || size <= 1) throw err;
          size = Math.max(1, Math.floor(size / 2));
          if (!first) pageSize = size;
        }
      }
    },

    /** @returns {Promise<{ name: string, myshopifyDomain: string }>} */
    async shopName() {
      const data = await gql('query TetherSyncShop { shop { name myshopifyDomain } }');
      const { name, myshopifyDomain } = asRecord(data['shop']);
      return { name: stringOrNull(name) ?? '', myshopifyDomain: stringOrNull(myshopifyDomain) ?? '' };
    },

    /**
     * This app's webhook subscriptions.
     *
     * @returns {Promise<WebhookSubscription[]>}
     */
    async listWebhooks() {
      const data = await gql(
        'query TetherSyncWebhooks { webhookSubscriptions(first: 100) { nodes { id topic uri } } }',
      );
      return asList(asRecord(data['webhookSubscriptions'])['nodes']).map(parseWebhook);
    },

    /**
     * @param {string} topic A `WebhookSubscriptionTopic`, e.g. `PRODUCTS_UPDATE`.
     * @param {string} uri
     * @returns {Promise<WebhookSubscription>}
     * @throws {SyncError} When Shopify answers with user errors.
     */
    async createWebhook(topic, uri) {
      const data = await gql(
        `mutation TetherSyncWebhookCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id topic uri } userErrors { field message } }
}`,
        { topic, sub: { uri } },
      );
      const result = asRecord(data['webhookSubscriptionCreate']);
      const userErrors = asList(result['userErrors']).map((error) => stringOrNull(asRecord(error)['message']) ?? '');
      if (userErrors.length) throw new SyncError(`webhook ${topic}: ${userErrors.join(' | ')}`);
      return parseWebhook(result['webhookSubscription']);
    },
  };
}
