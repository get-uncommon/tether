/**
 * The sync engine: Shopify products into a CMS target (the Webflow client, or the deploy-hook stand-in). Every entry
 * point runs one at a time per engine and is safe to re-run: a product whose mapped fieldData hashes the same as its
 * last published write causes no write (see sync-product.js).
 *
 * Budgets: a reconcile stops before it runs out of subrequests (Cloudflare free plan: 50) and saves exactly where it
 * was, so the next run continues there (see reconcile.js).
 */
import { createItemIndex } from './item-index.js';
import { normalizeConfig } from './mapping.js';
import { reconcile } from './reconcile.js';
import { createSerialQueue } from './serial.js';
import { SINCE_KEY } from './sync-state.js';
import { flushPublish, queueRetry, removeProduct, syncProduct } from './sync-product.js';
import { messageOf, noopLogger, productGid, scalarText } from './util.js';

/** @typedef {import('./mapping.js').Product} Product */
/** @typedef {import('./mapping.js').RawConfig} RawConfig */
/** @typedef {import('./mapping.js').SyncConfig} SyncConfig */
/** @typedef {import('./reconcile.js').Budget} Budget */
/** @typedef {import('./reconcile.js').ProductSource} ProductSource */
/** @typedef {import('./reconcile.js').ReconcileOptions} ReconcileOptions */
/** @typedef {import('./reconcile.js').ReconcileResult} ReconcileResult */
/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./sync-product.js').SyncContext} SyncContext */
/** @typedef {import('./sync-product.js').SyncProductOptions} SyncProductOptions */
/** @typedef {import('./sync-product.js').SyncResult} SyncResult */
/** @typedef {import('./sync-product.js').SyncStats} SyncStats */
/** @typedef {import('./util.js').Logger} Logger */
/** @typedef {import('./webflow.js').CmsTarget} CmsTarget */

/**
 * @typedef {object} ImportOptions
 * @property {boolean} [prune] Also archive or delete the items whose Shopify product no longer exists.
 * @property {boolean} [force] Write every product, changed or not.
 * @property {string | null} [query] A product search; defaults to `shopify.query`. A filtered import never prunes.
 * @property {(count: number, product: Product) => void} [onProgress]
 */

/** @typedef {{ itemId: string, shopifyId: string, slug: unknown }} PrunedItem */

/**
 * @typedef {object} ImportResult
 * @property {number} products
 * @property {{ id: string, handle: string, error: string }[]} failures
 * @property {PrunedItem[]} pruned
 * @property {SyncStats} stats
 */

/**
 * @typedef {object} SyncEngine
 * @property {SyncConfig} config
 * @property {SyncStats} stats
 * @property {(product: Product, options?: SyncProductOptions) => Promise<SyncResult>} syncProduct
 * @property {(id: string | number) => Promise<SyncResult>} syncById Fetches the product from Shopify, then syncs it,
 *   or removes its item when Shopify no longer has it. Webhooks use it.
 * @property {(id: string | number) => Promise<SyncResult>} removeProduct The product was deleted in Shopify.
 * @property {(id: string | number, error: unknown) => Promise<void>} queueRetry Retries a product on the next
 *   reconcile.
 * @property {() => Promise<string[]>} flushPublish
 * @property {(options?: ReconcileOptions) => Promise<ReconcileResult>} reconcile
 * @property {(options?: ImportOptions) => Promise<ImportResult>} importAll Every product. Sets the reconcile cursor,
 *   so reconcile picks up from here. Meant for the Node CLI: it has no subrequest budget.
 */

/** Items published per batch during an import, so a crash halfway leaves published items behind. */
const IMPORT_PUBLISH_BATCH = 100;

/**
 * Archives or deletes the items whose product the import didn't see.
 *
 * @param {SyncContext} ctx
 * @param {Set<string>} seen Shopify ids.
 * @returns {Promise<PrunedItem[]>}
 */
async function prune(ctx, seen) {
  /** @type {PrunedItem[]} */
  const pruned = [];
  for (const item of await ctx.index.listItems()) {
    const shopifyId = scalarText(item.fieldData[ctx.cfg.match.idField]);
    if (!shopifyId || seen.has(shopifyId) || item.isArchived) continue;
    const result = await removeProduct(ctx, shopifyId);
    if (result.action !== 'skipped') pruned.push({ itemId: item.id, shopifyId, slug: item.fieldData['slug'] });
  }
  return pruned;
}

/**
 * @param {SyncContext} ctx
 * @param {ProductSource} shopify
 * @param {ImportOptions} [options]
 * @returns {Promise<ImportResult>}
 */
async function importAll(ctx, shopify, options = {}) {
  const { prune: shouldPrune = false, force = false, query = ctx.cfg.shopify.query || null, onProgress } = options;
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {ImportResult['failures']} */
  const failures = [];
  /** @type {string | null} */
  let newest = null;
  /** @type {string | null} */
  let after = null;
  let count = 0;
  for (;;) {
    const page = await shopify.listProducts({ after, query });
    for (const product of page.products) {
      seen.add(product.legacyId);
      try {
        await syncProduct(ctx, product, { force, publishNow: false });
      } catch (err) {
        ctx.stats.failed++;
        failures.push({ id: product.legacyId, handle: product.handle, error: messageOf(err) });
        ctx.log.error(`sync ${product.handle} failed: ${messageOf(err)}`);
      }
      if (!newest || product.updatedAt > newest) newest = product.updatedAt;
      count++;
      if (onProgress) onProgress(count, product);
    }
    if (ctx.toPublish.size >= IMPORT_PUBLISH_BATCH) await flushPublish(ctx);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  await flushPublish(ctx);

  /** @type {PrunedItem[]} */
  let pruned = [];
  if (shouldPrune && !query) pruned = await prune(ctx, seen);
  else if (shouldPrune) ctx.log.warn('prune skipped: it needs a full import (no shopify.query filter)');

  if (!ctx.dryRun && newest) await ctx.store.put(SINCE_KEY, newest);
  return { products: count, failures, pruned, stats: { ...ctx.stats } };
}

/**
 * The collection's field slugs, listed once per engine, when mapped fields it lacks are skipped.
 *
 * @param {SyncConfig} cfg
 * @param {CmsTarget} target
 * @param {Logger} log
 * @returns {() => Promise<Set<string> | null>}
 */
function collectionFieldsOnce(cfg, target, log) {
  /** @type {Set<string> | null} */
  let slugs = null;
  return async () => {
    if (!cfg.webflow.skipMissingFields) return null;
    if (slugs) return slugs;
    const collection = await target.getCollection();
    const found = new Set(collection.fields.map((field) => field.slug));
    slugs = found;
    const dropped = Object.keys(cfg.fields).filter((slug) => slug !== 'name' && slug !== 'slug' && !found.has(slug));
    if (dropped.length) log.debug?.(`not in the collection, skipped: ${dropped.join(', ')}`);
    return found;
  };
}

/**
 * @param {object} options
 * @param {RawConfig} options.config Normalized here, so a normalized config works too.
 * @param {ProductSource} options.shopify
 * @param {CmsTarget} options.webflow Where items are written.
 * @param {Store} options.store
 * @param {Logger} [options.log]
 * @param {() => number} [options.now]
 * @param {boolean} [options.dryRun]
 * @param {Budget | null} [options.budget] The subrequests left, or `null` for no limit.
 * @returns {SyncEngine}
 */
export function createSync({
  config,
  shopify,
  webflow,
  store,
  log = noopLogger,
  now = () => Date.now(),
  dryRun = false,
  budget = null,
}) {
  const cfg = normalizeConfig(config);
  /** @type {SyncContext} */
  const ctx = {
    cfg,
    target: webflow,
    store,
    log,
    now,
    dryRun,
    index: createItemIndex({ target: webflow, store, match: cfg.match, now, dryRun }),
    stats: { created: 0, updated: 0, unchanged: 0, archived: 0, deleted: 0, skipped: 0, failed: 0 },
    toPublish: new Map(),
    collectionFields: collectionFieldsOnce(cfg, webflow, log),
  };
  const enqueue = createSerialQueue();

  /**
   * One operation at a time per engine; the item index is saved after each.
   *
   * @template T
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  const serial = (operation) =>
    enqueue(async () => {
      try {
        return await operation();
      } finally {
        await ctx.index.save();
      }
    });

  return {
    config: cfg,
    stats: ctx.stats,
    syncProduct: (product, options) => serial(() => syncProduct(ctx, product, options)),
    syncById: (id) =>
      serial(async () => {
        const product = await shopify.getProduct(productGid(id));
        return product ? syncProduct(ctx, product) : removeProduct(ctx, id);
      }),
    removeProduct: (id) => serial(() => removeProduct(ctx, id)),
    queueRetry: (id, error) => serial(() => queueRetry(ctx, id, error)),
    flushPublish: () => serial(() => flushPublish(ctx)),
    reconcile: (options) => serial(() => reconcile(ctx, shopify, budget, options)),
    importAll: (options) => serial(() => importAll(ctx, shopify, options)),
  };
}
