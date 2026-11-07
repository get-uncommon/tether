/**
 * Product data for the browser script. Products asked for in the same tick go out as one request, and every product
 * is cached for the life of the page, which survives Barba/Swup page swaps. Products the server rendered
 * (`tether/server` `hydrate()`) are used at once and refreshed once in the background.
 */
import { cfg, log } from './config.ts';
import { gql, matches, orNull, TetherError } from './client.ts';
import { productFragment } from './fragments.ts';
import { productKey } from './shopify-values.ts';
import { isRecord } from '../server/src/shared/json.ts';
import { PRODUCT, PRODUCT_NODE } from './product-shape.ts';
import type { Product, Image } from './fragments.ts';
import type { QueryText } from './client.ts';

/**
 * A product request that missed is remembered this long, so one page asking twice sends one request, and a product
 * published in Shopify meanwhile shows up on the next visit.
 */
const MISS_CACHE_MS = 10_000;
/** A product loaded live this recently is newer than a server-rendered copy of it, which is then ignored. */
const FRESH_MS = 60_000;

interface Waiter {
  resolve: (product: Product) => void;
  reject: (error: unknown) => void;
}

/** Handle or gid to the product, loaded or loading. */
const productCache = new Map<string, Promise<Product>>();
const waiting = new Map<string, Waiter>();
/** Keys of products that came from the server and weren't refreshed yet. */
const stale = new Set<string>();
/** Handle or gid to when it last loaded live, in ms since the epoch. */
const freshAt = new Map<string, number>();
/** Keys for the next batch. */
const pending: string[] = [];
let flushScheduled = false;
/**
 * Bumped by `clearProductCache()`: responses to requests sent before that (in the old market, after a country
 * switch) still reach their callers but never refill the cache.
 */
let generation = 0;

const isGid = (key: string) => key.startsWith('gid://');

/** Accepts a handle, numeric id, gid or a full product URL. */
export const normalizeProductKey = productKey;

/** Puts a product the page already has (from a collection query) in the cache, under its handle and its id. */
export function primeProduct(product: Product | null | undefined): void {
  if (!product) return;
  const loaded = Promise.resolve(product);
  productCache.set(product.handle, loaded);
  productCache.set(product.id, loaded);
}

/**
 * @param rawKey A handle, numeric id, gid or product URL.
 * @throws {TetherError} `NOT_FOUND` (rejected) for an empty key or a product the store doesn't have.
 */
export function getProduct(rawKey: string | number | null | undefined): Promise<Product> {
  const key = normalizeProductKey(rawKey);
  if (!key) return Promise.reject(new TetherError('empty product key', { code: 'NOT_FOUND' }));
  const cached = productCache.get(key);
  if (cached) return cached;

  const loading = new Promise<Product>((resolve, reject) => {
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
 * @param operation An operation that spreads `...TetherProduct`.
 * @returns The operation with the product fragment (which starts on its own line), written for what the token may
 *   read.
 */
export const withProductFragment =
  (operation: string): QueryText =>
  (access) =>
    `${operation}${productFragment(cfg, access)}`;

/**
 * @param keys Handles and gids.
 * @returns One query for all of them: gids through `nodes(ids:)` as `byId`, each handle as its own alias `h<index>`.
 */
function batchQuery(keys: string[]): { query: QueryText; variables: Record<string, unknown>; handles: string[] } {
  const ids = keys.filter(isGid);
  const handles = keys.filter((key) => !isGid(key));
  const definitions: string[] = [];
  const selections: string[] = [];
  const variables: Record<string, unknown> = {};
  if (ids.length) {
    definitions.push('$ids: [ID!]!');
    variables['ids'] = ids;
    selections.push(`byId: nodes(ids: $ids) { ... on Product { ...TetherProduct } }`);
  }
  handles.forEach((handle, index) => {
    definitions.push(`$h${index}: String!`);
    variables[`h${index}`] = handle;
    selections.push(`h${index}: product(handle: $h${index}) { ...TetherProduct }`);
  });
  const query = withProductFragment(`query TetherProducts(${definitions.join(',')}) { ${selections.join(' ')} }`);
  return { query, variables, handles };
}

function settleWaiting(key: string, settle: (waiter: Waiter) => void): void {
  const waiter = waiting.get(key);
  waiting.delete(key);
  if (waiter) settle(waiter);
}

function forgetMissLater(key: string, batchGeneration: number): void {
  if (batchGeneration !== generation) return;
  const miss = productCache.get(key);
  setTimeout(() => {
    if (productCache.get(key) === miss) productCache.delete(key);
  }, MISS_CACHE_MS);
}

/** A node of a type other than Product, for which `... on Product` selects no field. */
interface OtherNode {
  id?: undefined;
}
/** The answer to `batchQuery`: `byId` for the gids, `h<index>` for each handle. */
type BatchData = Partial<Record<`h${number}`, Product | null>> & { byId?: (Product | OtherNode | null)[] };

function isBatchData(data: unknown): data is BatchData {
  if (!isRecord(data)) return false;
  const { byId = [], ...byHandle } = data;
  return matches(byId, [orNull(PRODUCT_NODE)]) && Object.values(byHandle).every(orNull(PRODUCT));
}

async function flush() {
  flushScheduled = false;
  const batchGeneration = generation;
  const keys = pending.splice(0);
  if (!keys.length) return;
  const { query, variables, handles } = batchQuery(keys);
  log('fetch products', keys);

  let data;
  try {
    data = await gql(query, variables, isBatchData);
  } catch (error) {
    keys.forEach((key) => {
      settleWaiting(key, (waiter) => {
        if (batchGeneration === generation) productCache.delete(key);
        waiter.reject(error);
      });
    });
    return;
  }

  const found = new Map<string, Product>();
  for (const product of data.byId ?? []) if (product?.id) found.set(product.id, product);
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
export function clearProductCache(): void {
  productCache.clear();
  generation += 1;
  stale.clear();
  freshAt.clear();
}

/**
 * Uses products the server rendered, unless the page loaded the same product live in the last `FRESH_MS` (an earlier
 * page of a View Transition visit), whose copy is newer.
 */
export function hydrateProducts(products: readonly Product[] | null | undefined): void {
  for (const product of products ?? []) {
    if (!product.id || !product.handle) continue;
    const loadedAgo = Date.now() - (freshAt.get(product.handle) ?? 0);
    if (loadedAgo < FRESH_MS && productCache.has(product.handle)) continue;
    primeProduct(product);
    stale.add(product.handle);
    stale.add(product.id);
  }
}

/** @returns True once per server-rendered product: the caller then refreshes it. */
export function takeStale(rawKey: string | number | null | undefined): boolean {
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

/** Loads this product again, past the cache. Products refreshed in the same tick go out as one request. */
export function refreshProduct(key: string | number): Promise<Product> {
  const normalized = normalizeProductKey(key);
  if (normalized) productCache.delete(normalized);
  return getProduct(key);
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}
export interface Collection {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  image: Image | null;
  seo: { title: string | null; description: string | null };
}
export interface ProductPage {
  collection: Collection | null;
  products: Product[];
  pageInfo: PageInfo;
}
export interface ProductQuery {
  /** A collection handle; without one, a search. */
  collection?: string;
  /** Storefront search syntax, for a search. */
  query?: string;
  first?: number;
  /** The cursor of the page before. */
  after?: string | null;
  /** `ProductCollectionSortKeys` for a collection, `ProductSortKeys` for a search. */
  sortKey?: string;
  reverse?: boolean;
  /** `ProductFilter` values, for a collection. */
  filters?: unknown[];
}
