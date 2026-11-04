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

  const query = `query TetherProducts(${defs.join(', ')}) {\n  ${parts.join('\n  ')}\n}\n${productFragment()}`;
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
      if (got.has(k)) { primeProduct(got.get(k)); r.resolve(got.get(k)); } else {
        productCache.delete(k); // don't cache misses: a fix in Shopify works on next load
        r.reject(new TetherError(`Product not found: ${k}`, { code: 'NOT_FOUND' }));
      }
    }));
  } catch (err) {
    keys.forEach((k) => settle(k, (r) => { productCache.delete(k); r.reject(err); }));
  }
}

export function clearProductCache() { productCache.clear(); }

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

export async function getRecommendations(productId, intent = 'RELATED') {
  const data = await gql(`query TetherRecs($id: ID!, $intent: ProductRecommendationIntent) {
  productRecommendations(productId: $id, intent: $intent) { ...TetherProduct }
}
${productFragment()}`, { id: productId, intent });
  const list = data.productRecommendations || [];
  list.forEach(primeProduct);
  return list;
}
