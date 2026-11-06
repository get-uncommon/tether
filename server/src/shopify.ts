/**
 * Shopify Admin GraphQL client (read-only: products).
 *
 * Auth, either:
 *   - adminToken: a static Admin API token (shpat_...) from an existing custom app, or
 *   - clientId + clientSecret: a Dev Dashboard app installed on your own store. Tokens come
 *     from the client credentials grant, last ~24h and are refreshed automatically.
 * Scope needed: read_products (add read_inventory if you map inventory).
 */
import { ADMIN_API_VERSION } from './shared/api-versions.ts';
import { SyncError, sleep as realSleep } from './util.ts';
import { asList, asRecord, responseJsonOrNull, stringOrNull } from './json.ts';
import { tokenSource } from './shopify-token.ts';
import { normalizeProduct } from './product.ts';

import type { Product } from './product.ts';
import type { Store } from './store.ts';

export { normalizeProduct };

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
 */
export function pageSizeFor({
  variantsFirst = DEFAULT_VARIANTS_FIRST,
  mediaFirst = DEFAULT_MEDIA_FIRST,
  metafields = [],
}: { variantsFirst?: number; mediaFirst?: number; metafields?: string[] } = {}): number {
  const perProduct = PRODUCT_BASE_COST + variantsFirst + mediaFirst + metafields.length;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(PAGE_COST_BUDGET / perProduct)));
}

/**
 * The `TetherSyncProduct` fragment {@link normalizeProduct} parses. Metafields are aliased `mf0`, `mf1`... in the
 * order of `metafields`.
 */
export function productFragment({
  metafields = [],
  inventory = false,
  mediaFirst = DEFAULT_MEDIA_FIRST,
  variantsFirst = DEFAULT_VARIANTS_FIRST,
}: { metafields?: string[]; inventory?: boolean; mediaFirst?: number; variantsFirst?: number } = {}): string {
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

interface ShopifyOptions {
  /** The `.myshopify.com` domain; a scheme or path is stripped. */
  domain: string | undefined;
  adminToken?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  apiVersion?: string | undefined;
  /** `namespace.key` refs fetched with every product. */
  metafields?: string[] | undefined;
  inventory?: boolean | undefined;
  fetch?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
  /** Retries after a 429, a 5xx or a THROTTLED error. */
  retries?: number | undefined;
  variantsFirst?: number | undefined;
  mediaFirst?: number | undefined;
  /** Caches the client-credentials token: one token request a day instead of one per run. */
  tokenStore?: Store | null | undefined;
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface WebhookSubscription {
  id: string;
  topic: string;
  uri: string;
}

interface GraphqlError {
  message: string;
  code: string | undefined;
}

type Gql = (query: string, variables?: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** The queries the sync and the setup check send, on top of `gql`. */
export interface ShopifyClient {
  shop: string;
  apiVersion: string;
  gql: Gql;
  /** `null` when the store has no such product. */
  getProduct: (gid: string) => Promise<Product | null>;
  readonly pageSize: number;
  /** One page of products, oldest update first. Shrinks the page if Shopify says it costs too much. */
  listProducts: (options?: {
    first?: number | undefined;
    after?: string | null | undefined;
    query?: string | null | undefined;
  }) => Promise<{ products: Product[]; pageInfo: PageInfo }>;
  shopName: () => Promise<{ name: string; myshopifyDomain: string }>;
  /** This app's webhook subscriptions. */
  listWebhooks: () => Promise<WebhookSubscription[]>;
  /**
   * @param topic A `WebhookSubscriptionTopic`, e.g. `PRODUCTS_UPDATE`.
   * @throws {SyncError} When Shopify answers with user errors.
   */
  createWebhook: (topic: string, uri: string) => Promise<WebhookSubscription>;
}

/** @param errors The `errors` field of a GraphQL answer. */
function parseGraphqlErrors(errors: unknown): GraphqlError[] {
  return asList(errors).map((error) => {
    const { message, extensions } = asRecord(error);
    const code = stringOrNull(asRecord(extensions)['code']) ?? undefined;
    return { message: stringOrNull(message) ?? 'unknown error', code };
  });
}

export function createShopify(options: ShopifyOptions): ShopifyClient {
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

  const backOff = (attempt: number) => sleep(RETRY_BASE_MS * 2 ** attempt);

  const gql: Gql = async function gql(query, variables = {}) {
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
  };

  return shopifyClient(gql, { shop, apiVersion, metafields, inventory, variantsFirst, mediaFirst });
}

function parseWebhook(raw: unknown): WebhookSubscription {
  const { id, topic, uri } = asRecord(raw);
  return { id: stringOrNull(id) ?? '', topic: stringOrNull(topic) ?? '', uri: stringOrNull(uri) ?? '' };
}

function parsePageInfo(raw: unknown): PageInfo {
  const { hasNextPage, endCursor } = asRecord(raw);
  return { hasNextPage: hasNextPage === true, endCursor: stringOrNull(endCursor) };
}

function costTooHigh(error: unknown): boolean {
  return error instanceof SyncError && error.code === 'MAX_COST_EXCEEDED';
}

interface ClientSettings {
  shop: string;
  apiVersion: string;
  metafields: string[];
  inventory: boolean;
  variantsFirst: number;
  mediaFirst: number;
}

function shopifyClient(
  gql: Gql,
  { shop, apiVersion, metafields, inventory, variantsFirst, mediaFirst }: ClientSettings,
): ShopifyClient {
  const fragment = productFragment({ metafields, inventory, variantsFirst, mediaFirst });
  let pageSize = pageSizeFor({ variantsFirst, mediaFirst, metafields });

  async function listPage(
    first: number,
    after: string | null,
    query: string | null,
  ): Promise<{ products: Product[]; pageInfo: PageInfo }> {
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

    async shopName() {
      const data = await gql('query TetherSyncShop { shop { name myshopifyDomain } }');
      const { name, myshopifyDomain } = asRecord(data['shop']);
      return { name: stringOrNull(name) ?? '', myshopifyDomain: stringOrNull(myshopifyDomain) ?? '' };
    },

    async listWebhooks() {
      const data = await gql(
        'query TetherSyncWebhooks { webhookSubscriptions(first: 100) { nodes { id topic uri } } }',
      );
      return asList(asRecord(data['webhookSubscriptions'])['nodes']).map(parseWebhook);
    },

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
