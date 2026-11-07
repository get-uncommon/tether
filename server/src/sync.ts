/**
 * The sync engine: Shopify products into a CMS target (the Webflow client, or the deploy-hook stand-in). Every entry
 * point runs one at a time per engine and is safe to re-run: a product whose mapped fieldData hashes the same as its
 * last published write causes no write (see sync-product.ts).
 *
 * Budgets: a reconcile stops before it runs out of subrequests (Cloudflare free plan: 50) and saves exactly where it
 * was, so the next run continues there (see reconcile.ts).
 */
import { createItemIndex } from './item-index.ts';
import { normalizeConfig } from './mapping.ts';
import { reconcile } from './reconcile.ts';
import { createSerialQueue } from './shared/serial.ts';
import { SINCE_KEY } from './sync-state.ts';
import { PublishError, flushPublish, queueRetry, removeProduct, syncProduct } from './sync-product.ts';
import { noopLogger, productGid, scalarText } from './util.ts';
import { messageOf } from './shared/error-message.ts';

import type { RawConfig, SyncConfig } from './mapping.ts';
import type { Product } from './product.ts';
import type { Budget, ProductSource, ReconcileOptions, ReconcileResult } from './reconcile.ts';
import type { Store } from './store.ts';
import type { QueueRetryOptions, SyncContext, SyncProductOptions, SyncResult, SyncStats } from './sync-product.ts';
import type { Logger } from './util.ts';
import type { CmsTarget } from './webflow.ts';

export interface ImportOptions {
  /** Also archive or delete the items whose Shopify product no longer exists. */
  prune?: boolean;
  /** Write every product, changed or not. */
  force?: boolean;
  /** A product search; defaults to `shopify.query`. A filtered import never prunes. */
  query?: string | null;
  onProgress?: (count: number, product: Product) => void;
}

interface PrunedItem {
  itemId: string;
  shopifyId: string;
  slug: unknown;
}

export interface ImportResult {
  products: number;
  failures: { id: string; handle: string; error: string }[];
  pruned: PrunedItem[];
  stats: SyncStats;
}

export interface SyncEngine {
  config: SyncConfig;
  stats: SyncStats;
  syncProduct: (product: Product, options?: SyncProductOptions) => Promise<SyncResult>;
  /**
   * Fetches the product from Shopify, then syncs it, or removes its item when Shopify no longer has it. Webhooks
   * use it.
   */
  syncById: (id: string | number) => Promise<SyncResult>;
  /** The product was deleted in Shopify. */
  removeProduct: (id: string | number) => Promise<SyncResult>;
  /** Retries a product on the next reconcile. */
  queueRetry: (id: string | number, error: unknown, options?: QueueRetryOptions) => Promise<void>;
  flushPublish: () => Promise<string[]>;
  reconcile: (options?: ReconcileOptions) => Promise<ReconcileResult>;
  /**
   * Every product. Sets the reconcile cursor, so reconcile picks up from here. Meant for the Node CLI: it has no
   * subrequest budget.
   */
  importAll: (options?: ImportOptions) => Promise<ImportResult>;
}

/** Items published per batch during an import, so a crash halfway leaves published items behind. */
const IMPORT_PUBLISH_BATCH = 100;

/**
 * Archives or deletes the items whose product the import didn't see.
 *
 * @param seen Shopify ids.
 */
async function prune(ctx: SyncContext, seen: Set<string>): Promise<PrunedItem[]> {
  const pruned: PrunedItem[] = [];
  for (const item of await ctx.index.listItems()) {
    const shopifyId = scalarText(item.fieldData[ctx.cfg.match.idField]);
    if (!shopifyId || seen.has(shopifyId) || item.isArchived) continue;
    const result = await removeProduct(ctx, shopifyId);
    if (result.action !== 'skipped') pruned.push({ itemId: item.id, shopifyId, slug: item.fieldData['slug'] });
  }
  return pruned;
}

/**
 * Publishes the batch. Items Webflow leaves out are import failures; a failed publish call ends the import.
 */
async function publishImported(ctx: SyncContext, failures: ImportResult['failures']): Promise<void> {
  try {
    await flushPublish(ctx);
  } catch (err) {
    if (!(err instanceof PublishError) || !err.refused) throw err;
    for (const { id, handle } of err.products) failures.push({ id, handle, error: err.message });
  }
}

async function importAll(ctx: SyncContext, shopify: ProductSource, options: ImportOptions = {}): Promise<ImportResult> {
  const { prune: shouldPrune = false, force = false, query = ctx.cfg.shopify.query || null, onProgress } = options;
  const seen = new Set<string>();
  const failures: ImportResult['failures'] = [];
  let newest: string | null = null;
  let after: string | null = null;
  let count = 0;
  for (;;) {
    const page = await shopify.listProductEdges({ after, query });
    for (const { product } of page.edges) {
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
    if (ctx.toPublish.size >= IMPORT_PUBLISH_BATCH) await publishImported(ctx, failures);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  await publishImported(ctx, failures);

  let pruned: PrunedItem[] = [];
  if (shouldPrune && !query) pruned = await prune(ctx, seen);
  else if (shouldPrune) ctx.log.warn('prune skipped: it needs a full import (no shopify.query filter)');

  if (!ctx.dryRun && newest) await ctx.store.put(SINCE_KEY, newest);
  return { products: count, failures, pruned, stats: { ...ctx.stats } };
}

/** The collection's field slugs, listed once per engine, when mapped fields it lacks are skipped. */
function collectionFieldsOnce(cfg: SyncConfig, target: CmsTarget, log: Logger): () => Promise<Set<string> | null> {
  let slugs: Set<string> | null = null;
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

interface SyncOptions {
  /** Normalized here, so a normalized config works too. */
  config: RawConfig;
  shopify: ProductSource;
  /** Where items are written. */
  webflow: CmsTarget;
  store: Store;
  log?: Logger;
  now?: () => number;
  dryRun?: boolean;
  /** The subrequests left, or `null` for no limit. */
  budget?: Budget | null;
  /** The pages of Webflow items one run may list for the item index. */
  maxIndexPages?: number;
}

export function createSync({
  config,
  shopify,
  webflow,
  store,
  log = noopLogger,
  now = () => Date.now(),
  dryRun = false,
  budget = null,
  maxIndexPages = Infinity,
}: SyncOptions): SyncEngine {
  const cfg = normalizeConfig(config);
  const outOfBudget = () => budget !== null && budget.left() < cfg.reconcile.reserveSubrequests;
  const ctx: SyncContext = {
    cfg,
    target: webflow,
    store,
    log,
    now,
    dryRun,
    index: createItemIndex({
      target: webflow,
      store,
      match: cfg.match,
      now,
      dryRun,
      outOfBudget,
      maxPages: maxIndexPages,
    }),
    stats: { created: 0, updated: 0, unchanged: 0, archived: 0, deleted: 0, skipped: 0, failed: 0 },
    toPublish: new Map(),
    collectionFields: collectionFieldsOnce(cfg, webflow, log),
  };
  const enqueue = createSerialQueue();

  /** One operation at a time per engine; the item index is saved after each. */
  const serial = <T>(operation: () => Promise<T>): Promise<T> =>
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
    queueRetry: (id, error, options) => serial(() => queueRetry(ctx, id, error, options)),
    flushPublish: () => serial(() => flushPublish(ctx)),
    reconcile: (options) => serial(() => reconcile(ctx, shopify, outOfBudget, options)),
    importAll: (options) => serial(() => importAll(ctx, shopify, options)),
  };
}
