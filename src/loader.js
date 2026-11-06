// @ts-nocheck
/**
 * Data loading. Products are batched per tick into one request and cached for
 * the lifetime of the page (survives Barba/Swup page swaps).
 */
import { cfg, log } from './config.js';
import { gql, TetherError } from './client.js';
import { productFragment, collectionFields } from './fragments.js';

const productCache = new Map(); // key -> Promise<product>
let pending = [];
const resolvers = new Map();
let scheduled = false;
// Bumped by clearProductCache(): responses to requests sent before that (e.g. in the old
// market after a country switch) still reach their callers but never refill the cache.
let generation = 0;

const isGid = (v) => typeof v === 'string' && v.startsWith('gid://');

/** Accepts a handle, numeric id, gid or a full product URL. */
export function normalizeProductKey(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if (isGid(v)) return v;
  if (/^\d+$/.test(v)) return `gid://shopify/Product/${v}`;
  const m = v.match(/\/products\/([^/?#]+)/);
  return m ? m[1] : v;
}

/** Put a product we already have (from a collection query) in the cache. */
export function primeProduct(product) {
  if (!product) return;
  const p = Promise.resolve(product);
  productCache.set(product.handle, p);
  productCache.set(product.id, p);
}

export function getProduct(rawKey) {
  const key = normalizeProductKey(rawKey);
  if (!key) return Promise.reject(new TetherError('empty product key', { code: 'NOT_FOUND' }));
  if (productCache.has(key)) return productCache.get(key);

  const p = new Promise((resolve, reject) => {
    resolvers.set(key, { resolve, reject });
    pending.push(key);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  });
  productCache.set(key, p);
  return p;
}

async function flush() {
  scheduled = false;
  const gen = generation;
  const keys = pending.splice(0);
  if (!keys.length) return;

  const ids = keys.filter(isGid);
  const handles = keys.filter((k) => !isGid(k));
  const defs = [];
  const parts = [];
  const vars = {};

  if (ids.length) {
    defs.push('$ids: [ID!]!');
    vars.ids = ids;
    parts.push('byId: nodes(ids: $ids) { ... on Product { ...TetherProduct } }');
  }
  handles.forEach((h, i) => {
    defs.push(`$h${i}: String!`);
    vars[`h${i}`] = h;
    parts.push(`h${i}: product(handle: $h${i}) { ...TetherProduct }`);
  });

  const query = `query TetherProducts(${defs.join(',')}) { ${parts.join(' ')} } ${productFragment()}`;
  log('fetch products', keys);

  const settle = (k, fn) => {
    const r = resolvers.get(k);
    resolvers.delete(k);
    if (r) fn(r);
  };

  try {
    const data = await gql(query, vars);
    const got = new Map();
    (data.byId || []).forEach((p) => { if (p) got.set(p.id, p); });
    handles.forEach((h, i) => { if (data[`h${i}`]) got.set(h, data[`h${i}`]); });

    keys.forEach((k) => settle(k, (r) => {
      if (got.has(k)) {
        const p = got.get(k);
        if (gen === generation) { primeProduct(p); freshAt.set(p.handle, Date.now()); freshAt.set(p.id, Date.now()); }
        r.resolve(p);
      } else {
        // A miss is remembered for a few seconds (one page load asking twice makes one request),
        // not longer: a product published in Shopify shows up on the next visit.
        const miss = productCache.get(k);
        if (gen === generation) setTimeout(() => { if (productCache.get(k) === miss) productCache.delete(k); }, 10000);
        r.reject(new TetherError(`Product not found: ${k}`, { code: 'NOT_FOUND' }));
      }
    }));
  } catch (err) {
    keys.forEach((k) => settle(k, (r) => { if (gen === generation) productCache.delete(k); r.reject(err); }));
  }
}

export function clearProductCache() { productCache.clear(); generation++; stale.clear(); freshAt.clear(); }

// ---------------------------------------------------------------------------
// Hydration: products rendered on the server (tether/server hydrate()) are used at once and
// refreshed once in the background, so prices and stock are live without a loading state.
// ---------------------------------------------------------------------------

const stale = new Set(); // keys of products that came from the server and weren't refreshed yet
const freshAt = new Map(); // key -> when it was last loaded live (this page session)
const FRESH_MS = 60000;

export function hydrateProducts(products) {
  (products || []).forEach((p) => {
    if (!p?.id || !p.handle) return;
    // Loaded live in the last minute (an earlier page of a View Transition visit): that copy is newer.
    if (Date.now() - (freshAt.get(p.handle) || 0) < FRESH_MS && productCache.has(p.handle)) return;
    primeProduct(p);
    stale.add(p.handle);
    stale.add(p.id);
  });
}

/** True once per server-provided product: the caller refreshes it. */
export function takeStale(key) {
  const k = normalizeProductKey(key);
  if (!stale.has(k)) return false;
  const p = productCache.get(k);
  stale.delete(k);
  // Both keys point to the same product: refresh it once.
  p?.then?.((x) => { stale.delete(x.handle); stale.delete(x.id); });
  return true;
}

/** Fetch these products again (bypassing the cache). */
export function refreshProducts(keys) {
  keys.forEach((k) => productCache.delete(normalizeProductKey(k)));
  return keys.map((k) => getProduct(k));
}

/**
 * A page of products from a collection (by handle) or from a search query.
 * Returns { collection, products, pageInfo }.
 */
export async function getProducts({
  collection, query, first = cfg.collectionFirst, after = null, sortKey, reverse = false, filters,
} = {}) {
  const fragment = productFragment();

  if (collection) {
    const data = await gql(`query TetherCollection($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys, $reverse: Boolean, $filters: [ProductFilter!]) {
  collection(handle: $handle) {
    ${collectionFields()}
    products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, filters: $filters) {
      nodes { ...TetherProduct }
      pageInfo { hasNextPage endCursor }
    }
  }
}
${fragment}`, {
      handle: collection, first, after, sortKey: sortKey || undefined, reverse, filters: filters || undefined,
    });
    if (!data.collection) throw new TetherError(`Collection not found: ${collection}`, { code: 'NOT_FOUND' });
    const { products, ...rest } = data.collection;
    products.nodes.forEach(primeProduct);
    return { collection: rest, products: products.nodes, pageInfo: products.pageInfo };
  }

  const data = await gql(`query TetherSearch($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
  products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
    nodes { ...TetherProduct }
    pageInfo { hasNextPage endCursor }
  }
}
${fragment}`, { first, after, query: query || undefined, sortKey: sortKey || undefined, reverse });
  data.products.nodes.forEach(primeProduct);
  return { collection: null, products: data.products.nodes, pageInfo: data.products.pageInfo };
}

export async function getRecommendations(product, intent = 'RELATED') {
  const key = normalizeProductKey(typeof product === 'object' ? product?.id : product);
  const byId = key?.startsWith('gid://');
  const data = await gql(`query TetherRecs(${byId ? '$id: ID!' : '$handle: String!'}, $intent: ProductRecommendationIntent) {
  productRecommendations(${byId ? 'productId: $id' : 'productHandle: $handle'}, intent: $intent) { ...TetherProduct }
}
${productFragment()}`, byId ? { id: key, intent } : { handle: key, intent });
  const list = data.productRecommendations || [];
  list.forEach(primeProduct);
  return list;
}
