/**
 * Product data for the browser script. Products asked for in the same tick go out as one request, and every product
 * is cached for the life of the page, which survives Barba/Swup page swaps. Products the server rendered
 * (`tether/server` `hydrate()`) are used at once and refreshed once in the background.
 */
import { cfg, log } from './config.js';
import { gql, TetherError } from './client.js';
import { productFragment, collectionFields } from './fragments.js';
import { productKey } from './shopify-values.js';
/** @import { Product, Image } from './fragments.js' */
/** @import { QueryText } from './client.js' */

/**
 * A product request that missed is remembered this long, so one page asking twice sends one request, and a product
 * published in Shopify meanwhile shows up on the next visit.
 */
const MISS_CACHE_MS = 10_000;
/** A product loaded live this recently is newer than a server-rendered copy of it, which is then ignored. */
const FRESH_MS = 60_000;

/** @type {Map<string, Promise<Product>>} Handle or gid to the product, loaded or loading. */
const productCache = new Map();
/** @type {Map<string, { resolve: (product: Product) => void, reject: (error: unknown) => void }>} */
const waiting = new Map();
/** @type {Set<string>} Keys of products that came from the server and weren't refreshed yet. */
const stale = new Set();
/** @type {Map<string, number>} Handle or gid to when it last loaded live, in ms since the epoch. */
const freshAt = new Map();
/** @type {string[]} Keys for the next batch. */
const pending = [];
let flushScheduled = false;
/**
 * Bumped by `clearProductCache()`: responses to requests sent before that (in the old market, after a country
 * switch) still reach their callers but never refill the cache.
 */
let generation = 0;

/** @param {string} key */
const isGid = (key) => key.startsWith('gid://');

/** Accepts a handle, numeric id, gid or a full product URL. */
export const normalizeProductKey = productKey;

/**
 * Puts a product the page already has (from a collection query) in the cache, under its handle and its id.
 *
 * @param {Product | null | undefined} product
 */
export function primeProduct(product) {
  if (!product) return;
  const loaded = Promise.resolve(product);
  productCache.set(product.handle, loaded);
  productCache.set(product.id, loaded);
}

/**
 * @param {string | number | null | undefined} rawKey A handle, numeric id, gid or product URL.
 * @returns {Promise<Product>}
 * @throws {TetherError} `NOT_FOUND` (rejected) for an empty key or a product the store doesn't have.
 */
export function getProduct(rawKey) {
  const key = normalizeProductKey(rawKey);
  if (!key) return Promise.reject(new TetherError('empty product key', { code: 'NOT_FOUND' }));
  const cached = productCache.get(key);
  if (cached) return cached;

  /** @type {Promise<Product>} */
  const loading = new Promise((resolve, reject) => {
    waiting.set(key, { resolve, reject });
    pending.push(key);
    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(() => void flush(), 0);
    }
  });
  productCache.set(key, loading);
  return loading;
}

/**
 * @param {string} operation An operation that spreads `...TetherProduct`.
 * @returns {QueryText} The operation with the product fragment (which starts on its own line), written for what the token may read.
 */
const withProductFragment = (operation) => (access) => `${operation}${productFragment(cfg, access)}`;

/**
 * @param {string[]} keys Handles and gids.
 * @returns {{ query: QueryText, variables: Record<string, unknown>, handles: string[] }} One query for all of them: gids
 *   through `nodes(ids:)` as `byId`, each handle as its own alias `h<index>`.
 */
function batchQuery(keys) {
  const ids = keys.filter(isGid);
  const handles = keys.filter((key) => !isGid(key));
  const definitions = [];
  const selections = [];
  /** @type {Record<string, unknown>} */
  const variables = {};
  if (ids.length) {
    definitions.push('$ids: [ID!]!');
    variables['ids'] = ids;
    selections.push('byId: nodes(ids: $ids) { ... on Product { ...TetherProduct } }');
  }
  handles.forEach((handle, index) => {
    definitions.push(`$h${index}: String!`);
    variables[`h${index}`] = handle;
    selections.push(`h${index}: product(handle: $h${index}) { ...TetherProduct }`);
  });
  const query = withProductFragment(`query TetherProducts(${definitions.join(',')}) { ${selections.join(' ')} }`);
  return { query, variables, handles };
}

/**
 * @param {string} key
 * @param {(waiter: { resolve: (product: Product) => void, reject: (error: unknown) => void }) => void} settle
 */
function settleWaiting(key, settle) {
  const waiter = waiting.get(key);
  waiting.delete(key);
  if (waiter) settle(waiter);
}

/**
 * @param {string} key
 * @param {number} batchGeneration
 */
function forgetMissLater(key, batchGeneration) {
  if (batchGeneration !== generation) return;
  const miss = productCache.get(key);
  setTimeout(() => {
    if (productCache.get(key) === miss) productCache.delete(key);
  }, MISS_CACHE_MS);
}

async function flush() {
  flushScheduled = false;
  const batchGeneration = generation;
  const keys = pending.splice(0);
  if (!keys.length) return;
  const { query, variables, handles } = batchQuery(keys);
  log('fetch products', keys);

  /** @type {Record<string, Product | null> & { byId?: (Product | null)[] }} */
  let data;
  try {
    data = await gql(query, variables);
  } catch (error) {
    keys.forEach((key) => {
      settleWaiting(key, (waiter) => {
        if (batchGeneration === generation) productCache.delete(key);
        waiter.reject(error);
      });
    });
    return;
  }

  /** @type {Map<string, Product>} */
  const found = new Map();
  for (const product of data.byId ?? []) if (product) found.set(product.id, product);
  handles.forEach((handle, index) => {
    const product = data[`h${index}`];
    if (product) found.set(handle, product);
  });

  const now = Date.now();
  keys.forEach((key) => {
    settleWaiting(key, (waiter) => {
      const product = found.get(key);
      if (!product) {
        forgetMissLater(key, batchGeneration);
        waiter.reject(new TetherError(`Product not found: ${key}`, { code: 'NOT_FOUND' }));
        return;
      }
      if (batchGeneration === generation) {
        primeProduct(product);
        freshAt.set(product.handle, now);
        freshAt.set(product.id, now);
      }
      waiter.resolve(product);
    });
  });
}

/** Forgets every product, for a new market: requests already sent no longer fill the cache. */
export function clearProductCache() {
  productCache.clear();
  generation += 1;
  stale.clear();
  freshAt.clear();
}

/**
 * Uses products the server rendered, unless the page loaded the same product live in the last `FRESH_MS` (an earlier
 * page of a View Transition visit), whose copy is newer.
 *
 * @param {readonly Product[] | null | undefined} products
 */
export function hydrateProducts(products) {
  for (const product of products ?? []) {
    if (!product.id || !product.handle) continue;
    const loadedAgo = Date.now() - (freshAt.get(product.handle) ?? 0);
    if (loadedAgo < FRESH_MS && productCache.has(product.handle)) continue;
    primeProduct(product);
    stale.add(product.handle);
    stale.add(product.id);
  }
}

/**
 * @param {string | number | null | undefined} rawKey
 * @returns {boolean} True once per server-rendered product: the caller then refreshes it.
 */
export function takeStale(rawKey) {
  const key = normalizeProductKey(rawKey);
  if (!key || !stale.has(key)) return false;
  stale.delete(key);
  // The handle and the id point to the same product: one refresh covers both.
  void productCache.get(key)?.then((product) => {
    stale.delete(product.handle);
    stale.delete(product.id);
  }, failureIsReportedByTheRender);
  return true;
}

/**
 * The cached promise is the one the product's render awaits, and the render reports its failure: the stale cleanup
 * above has nothing left to do for a product that did not load.
 */
function failureIsReportedByTheRender() {
  // Nothing to clean: see above.
}

/**
 * Loads these products again, past the cache.
 *
 * @param {readonly (string | number)[]} keys
 * @returns {Promise<Product>[]}
 */
export function refreshProducts(keys) {
  for (const key of keys) {
    const normalized = normalizeProductKey(key);
    if (normalized) productCache.delete(normalized);
  }
  return keys.map((key) => getProduct(key));
}

/** @typedef {{ hasNextPage: boolean, endCursor: string | null }} PageInfo */
/**
 * @typedef {object} Collection
 * @property {string} id
 * @property {string} handle
 * @property {string} title
 * @property {string} description
 * @property {string} descriptionHtml
 * @property {Image | null} image
 * @property {{ title: string | null, description: string | null }} seo
 */
/** @typedef {{ collection: Collection | null, products: Product[], pageInfo: PageInfo }} ProductPage */
/**
 * @typedef {object} ProductQuery
 * @property {string} [collection] A collection handle; without one, a search.
 * @property {string} [query] Storefront search syntax, for a search.
 * @property {number} [first]
 * @property {string | null} [after] The cursor of the page before.
 * @property {string} [sortKey] `ProductCollectionSortKeys` for a collection, `ProductSortKeys` for a search.
 * @property {boolean} [reverse]
 * @property {unknown[]} [filters] `ProductFilter` values, for a collection.
 */

const COLLECTION_QUERY = `query TetherCollection($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys, $reverse: Boolean, $filters: [ProductFilter!]) {
  collection(handle: $handle) {
    ${collectionFields()}
    products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, filters: $filters) {
      nodes { ...TetherProduct }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const SEARCH_QUERY = `query TetherSearch($first: Int!, $after: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
  products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
    nodes { ...TetherProduct }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * A page of products from a collection (by handle) or from a search. Every product on it is cached.
 *
 * @param {ProductQuery} [options]
 * @returns {Promise<ProductPage>}
 * @throws {TetherError} `NOT_FOUND` for a collection the store doesn't have.
 */
export async function getProducts({
  collection,
  query,
  first = cfg.collectionFirst,
  after = null,
  sortKey,
  reverse = false,
  filters,
} = {}) {
  if (collection) {
    /** @type {{ collection: (Collection & { products: { nodes: Product[], pageInfo: PageInfo } }) | null }} */
    const data = await gql(withProductFragment(COLLECTION_QUERY), {
      handle: collection,
      first,
      after,
      sortKey: sortKey || undefined,
      reverse,
      filters: filters ?? undefined,
    });
    if (!data.collection) throw new TetherError(`Collection not found: ${collection}`, { code: 'NOT_FOUND' });
    const { products, ...rest } = data.collection;
    products.nodes.forEach(primeProduct);
    return { collection: rest, products: products.nodes, pageInfo: products.pageInfo };
  }

  /** @type {{ products: { nodes: Product[], pageInfo: PageInfo } }} */
  const data = await gql(withProductFragment(SEARCH_QUERY), {
    first,
    after,
    query: query || undefined,
    sortKey: sortKey || undefined,
    reverse,
  });
  data.products.nodes.forEach(primeProduct);
  return { collection: null, products: data.products.nodes, pageInfo: data.products.pageInfo };
}

/**
 * Shopify's recommendations for a product. Every product in them is cached.
 *
 * @param {string | number | { id: string } | null | undefined} product A product, or its handle, id or gid.
 * @param {'RELATED' | 'COMPLEMENTARY'} [intent]
 * @returns {Promise<Product[]>}
 */
export async function getRecommendations(product, intent = 'RELATED') {
  const key = normalizeProductKey(typeof product === 'object' ? product?.id : product);
  const byId = key?.startsWith('gid://') ?? false;
  /** @type {{ productRecommendations: Product[] | null }} */
  const data = await gql(
    withProductFragment(
      `query TetherRecs(${byId ? '$id: ID!' : '$handle: String!'}, $intent: ProductRecommendationIntent) {
  productRecommendations(${byId ? 'productId: $id' : 'productHandle: $handle'}, intent: $intent) { ...TetherProduct }
}`,
    ),
    byId ? { id: key, intent } : { handle: key, intent },
  );
  const list = data.productRecommendations ?? [];
  list.forEach(primeProduct);
  return list;
}
