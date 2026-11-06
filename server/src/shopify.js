// @ts-nocheck
/**
 * Shopify Admin GraphQL client (read-only: products).
 *
 * Auth, either:
 *   - adminToken: a static Admin API token (shpat_...) from an existing custom app, or
 *   - clientId + clientSecret: a Dev Dashboard app installed on your own store. Tokens come
 *     from the client credentials grant, last ~24h and are refreshed automatically.
 * Scope needed: read_products (add read_inventory if you map inventory).
 */
import { SyncError, sleep as realSleep } from './util.js';

export const DEFAULT_API_VERSION = '2026-07';

/**
 * Shopify rejects a query above 1,000 cost points. A product node costs roughly
 * 1 + variantsFirst + mediaFirst + its other fields, so a page holds ~800 / that.
 */
export function pageSizeFor({ variantsFirst = 25, mediaFirst = 10, metafields = [] } = {}) {
  const perProduct = 6 + variantsFirst + mediaFirst + metafields.length;
  return Math.max(1, Math.min(50, Math.floor(800 / perProduct)));
}

export function productFragment({ metafields = [], inventory = false, mediaFirst = 10, variantsFirst = 25 } = {}) {
  const mf = metafields.map((ref, i) => {
    const [namespace, ...rest] = ref.split('.');
    return `mf${i}: metafield(namespace: ${JSON.stringify(namespace)}, key: ${JSON.stringify(rest.join('.'))}) { value type }`;
  }).join('\n  ');
  return `fragment TetherSyncProduct on Product {
  id legacyResourceId handle title description descriptionHtml vendor productType tags status
  createdAt updatedAt publishedAt onlineStoreUrl${inventory ? ' totalInventory' : ''}
  seo { title description }
  priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
  compareAtPriceRange { minVariantCompareAtPrice { amount currencyCode } maxVariantCompareAtPrice { amount currencyCode } }
  featuredMedia { preview { image { url altText } } }
  media(first: ${mediaFirst}) { nodes { mediaContentType preview { image { url altText } } } }
  options { name optionValues { name } }
  variants(first: ${variantsFirst}) { nodes { id legacyResourceId title sku price compareAtPrice availableForSale${inventory ? ' inventoryQuantity' : ''} } }
  ${mf}
}`;
}

export function createShopify({
  domain, adminToken, clientId, clientSecret, apiVersion = DEFAULT_API_VERSION,
  metafields = [], inventory = false, fetch: fetchImpl = globalThis.fetch, sleep = realSleep, now = () => Date.now(),
  retries = 3, variantsFirst = 25, mediaFirst = 10,
  tokenStore = null, // { get, put }: caches the client-credentials token (one request a day instead of one per run)
}) {
  if (!domain) throw new SyncError('shopify.domain is required');
  if (!adminToken && !(clientId && clientSecret)) {
    throw new SyncError('Shopify auth missing: set SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET');
  }
  const shop = String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  let cached = adminToken ? { token: adminToken, expires: Infinity } : null;

  async function token() {
    if (cached && cached.expires > now() + 60000) return cached.token;
    if (!cached && tokenStore) {
      const saved = await tokenStore.get('shopify:token');
      if (saved?.token && saved.expires > now() + 60000) { cached = saved; return saved.token; }
    }
    const res = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
    });
    if (!res.ok) throw new SyncError(`Shopify token request failed (${res.status})`, { status: res.status, body: await res.text().catch(() => '') });
    const json = await res.json();
    cached = { token: json.access_token, expires: now() + (json.expires_in || 86399) * 1000 };
    if (tokenStore) await tokenStore.put('shopify:token', cached);
    return cached.token;
  }

  async function gql(query, variables = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await token() },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 401 && !adminToken && attempt < 1) { cached = null; tokenStore = null; continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new SyncError(`Shopify Admin API ${res.status}`, { status: res.status, body: json });
      if (json?.errors?.length) {
        if (json.errors.some((e) => e.extensions?.code === 'THROTTLED') && attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
        const code = json.errors.find((e) => e.extensions?.code)?.extensions.code;
        throw new SyncError(`Shopify Admin API: ${json.errors.map((e) => e.message).join(' | ')}`, { body: json, code });
      }
      return json.data;
    }
  }

  const fragment = productFragment({ metafields, inventory, variantsFirst, mediaFirst });
  let pageSize = pageSizeFor({ variantsFirst, mediaFirst, metafields });

  return {
    shop,
    apiVersion,
    gql,

    async getProduct(gid) {
      const data = await gql(`query TetherSyncGetProduct($id: ID!) { product(id: $id) { ...TetherSyncProduct } }\n${fragment}`, { id: gid });
      return data.product ? normalizeProduct(data.product, metafields) : null;
    },

    get pageSize() { return pageSize; },

    /** One page of products, oldest update first. Shrinks the page if Shopify says it costs too much. */
    async listProducts({ first, after = null, query = null } = {}) {
      let size = first || pageSize;
      for (;;) {
        try {
          return await listPage(size, after, query);
        } catch (err) {
          if (err.code !== 'MAX_COST_EXCEEDED' || size <= 1) throw err;
          size = Math.max(1, Math.floor(size / 2));
          if (!first) pageSize = size;
        }
      }
    },

    async shopName() {
      const data = await gql('query TetherSyncShop { shop { name myshopifyDomain } }');
      return data.shop;
    },

    /** This app's webhook subscriptions: [{ id, topic, uri }]. */
    async listWebhooks() {
      const data = await gql('query TetherSyncWebhooks { webhookSubscriptions(first: 100) { nodes { id topic uri } } }');
      return data.webhookSubscriptions.nodes;
    },

    async createWebhook(topic, uri) {
      const data = await gql(`mutation TetherSyncWebhookCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id topic uri } userErrors { field message } }
}`, { topic, sub: { uri } });
      const res = data.webhookSubscriptionCreate;
      if (res.userErrors?.length) throw new SyncError(`webhook ${topic}: ${res.userErrors.map((e) => e.message).join(' | ')}`);
      return res.webhookSubscription;
    },
  };

  async function listPage(first, after, query) {
    const data = await gql(`query TetherSyncProducts($first: Int!, $after: String, $query: String) {
  products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    nodes { ...TetherSyncProduct }
    pageInfo { hasNextPage endCursor }
  }
}
${fragment}`, { first, after, query });
    return { products: data.products.nodes.map((p) => normalizeProduct(p, metafields)), pageInfo: data.products.pageInfo };
  }
}

const num = (m) => (m && m.amount != null ? Number(m.amount) : null);
const image = (img) => (img?.url ? { url: img.url, alt: img.altText || null } : null);

/**
 * Flat, mapping-friendly shape. Every key here can be used as a source in
 * the field mapping, e.g. fields: { price: 'price', 'main-image': 'image' }.
 */
export function normalizeProduct(p, metafieldRefs = []) {
  const images = (p.media?.nodes || []).filter((m) => m.mediaContentType === 'IMAGE' || m.preview?.image).map((m) => image(m.preview?.image)).filter(Boolean);
  const variants = (p.variants?.nodes || []).map((v) => ({
    id: v.id, legacyId: String(v.legacyResourceId ?? ''), title: v.title, sku: v.sku || null,
    price: v.price != null ? Number(v.price) : null, compareAtPrice: v.compareAtPrice != null ? Number(v.compareAtPrice) : null,
    available: Boolean(v.availableForSale), inventory: v.inventoryQuantity ?? null,
  }));
  const metafields = {};
  metafieldRefs.forEach((ref, i) => { metafields[ref] = p[`mf${i}`]?.value ?? null; });
  const compareAt = num(p.compareAtPriceRange?.minVariantCompareAtPrice);
  const price = num(p.priceRangeV2?.minVariantPrice);

  return {
    id: p.id,
    legacyId: String(p.legacyResourceId ?? p.id.split('/').pop()),
    handle: p.handle,
    title: p.title,
    description: p.description || '',
    descriptionHtml: p.descriptionHtml || '',
    vendor: p.vendor || '',
    productType: p.productType || '',
    tags: p.tags || [],
    tagsText: (p.tags || []).join(', '),
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    publishedAt: p.publishedAt || null,
    onlineStoreUrl: p.onlineStoreUrl || null,
    seoTitle: p.seo?.title || null,
    seoDescription: p.seo?.description || null,
    price,
    maxPrice: num(p.priceRangeV2?.maxVariantPrice),
    compareAtPrice: compareAt && price != null && compareAt > price ? compareAt : null,
    currency: p.priceRangeV2?.minVariantPrice?.currencyCode || null,
    image: image(p.featuredMedia?.preview?.image) || images[0] || null,
    images,
    available: variants.some((v) => v.available),
    totalInventory: p.totalInventory ?? null,
    variantCount: variants.length,
    sku: variants[0]?.sku || null,
    options: (p.options || []).map((o) => ({ name: o.name, values: (o.optionValues || []).map((v) => v.name) })),
    variants,
    metafields,
  };
}
