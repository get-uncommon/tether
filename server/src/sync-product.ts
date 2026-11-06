/**
 * One product's sync and removal, the operations every engine entry point is built from. Idempotent: the mapped
 * fieldData is hashed and compared with the last *published* write, so the same Shopify product never causes a
 * second Webflow write.
 */
import { mapProduct, withoutOwned, onlyExisting } from './mapping.ts';
import { readProductState, readRetries, productKey, RETRY_KEY } from './sync-state.ts';
import { sha256, toHex } from './crypto.ts';
import { SyncError, httpStatusOf, numericId, scalarText, stableStringify } from './util.ts';

import type { ItemIndex } from './item-index.ts';
import type { FieldData, SyncConfig } from './mapping.ts';
import type { Product } from './product.ts';
import type { Store } from './store.ts';
import type { ProductState } from './sync-state.ts';
import type { Logger } from './util.ts';
import type { CmsTarget } from './webflow.ts';

export type SyncAction = 'created' | 'updated' | 'unchanged' | 'archived' | 'deleted' | 'skipped';
/** Counts for the engine's lifetime. */
export type SyncStats = Record<SyncAction | 'failed', number>;

/**
 * What one product's sync did. `reason` says why a product was skipped; a dry run reports the action it would take.
 */
export type SyncResult =
  | { action: SyncAction; itemId: string; reason?: undefined }
  | { action: 'skipped'; reason: string; itemId?: undefined }
  | { action: SyncAction; itemId: string | null; dryRun: true; fieldData?: FieldData; reason?: undefined };

/** What the engine's operations share. `toPublish` holds the states to store once their items are live. */
export interface SyncContext {
  cfg: SyncConfig;
  target: CmsTarget;
  store: Store;
  log: Logger;
  now: () => number;
  /** Reads everything, writes nothing. */
  dryRun: boolean;
  index: ItemIndex;
  stats: SyncStats;
  toPublish: Map<string, { key: string; state: ProductState }>;
  /** The collection's field slugs with `webflow.skipMissingFields`, or `null` to write every mapped field. */
  collectionFields: () => Promise<Set<string> | null>;
}

export interface SyncProductOptions {
  force?: boolean;
  publishNow?: boolean;
}

function record<R extends SyncResult>(stats: SyncStats, result: R): R {
  stats[result.action] += 1;
  return result;
}

const timestamp = (ctx: SyncContext) => new Date(ctx.now()).toISOString();

/** Webflow slugs are unique: a create for a slug another item holds is refused. */
function isSlugConflict(error: unknown): boolean {
  if (!(error instanceof SyncError) || (error.status !== 400 && error.status !== 409)) return false;
  return /slug|unique|already/i.test(`${error.message} ${JSON.stringify(error.body || '')}`);
}

/**
 * Runs a write on an item that may have been deleted in Webflow by hand; for a deletion or an archive that is the
 * outcome wanted anyway.
 */
async function unlessGone(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (err) {
    if (httpStatusOf(err) !== 404) throw err;
  }
}

interface ItemWrite {
  product: Product;
  fieldData: FieldData;
  /** The product is inactive and `inactive` is not `keep`. */
  hide: boolean;
  key: string;
}

async function updateItem(ctx: SyncContext, { fieldData, hide }: ItemWrite, itemId: string): Promise<void> {
  if (hide) await ctx.target.unpublish(itemId);
  const flags = { isArchived: hide && ctx.cfg.inactive === 'archive', isDraft: false };
  await ctx.target.updateItem(itemId, withoutOwned(fieldData, ctx.cfg), flags);
  ctx.index.remember(itemId, fieldData);
}

/**
 * Creates the item. When the slug is taken, a concurrent run (create and update webhooks for a new product) or a
 * stale index lost the race: the item that won is updated instead.
 */
async function createItem(
  ctx: SyncContext,
  write: ItemWrite,
): Promise<{ action: 'created' | 'updated'; itemId: string }> {
  const { product, fieldData, key } = write;
  try {
    const { id } = await ctx.target.createItem(fieldData, { isDraft: false, isArchived: false });
    ctx.index.remember(id, fieldData);
    // Stored before publishing: a crash or a concurrent webhook must find the item instead of creating another one.
    await ctx.store.put(key, { itemId: id, hash: null, handle: product.handle, at: timestamp(ctx) });
    return { action: 'created', itemId: id };
  } catch (err) {
    if (!isSlugConflict(err)) throw err;
    const winner = (await readProductState(ctx.store, key))?.itemId || (await ctx.index.find(product, { fresh: true }));
    if (!winner) throw err;
    await updateItem(ctx, write, winner);
    return { action: 'updated', itemId: winner };
  }
}

/** Updates the known item, or creates one when there is none or it was deleted in Webflow by hand. */
async function writeItem(
  ctx: SyncContext,
  write: ItemWrite,
  knownItemId: string | null,
): Promise<{ action: 'created' | 'updated' | 'archived'; itemId: string } | { action: 'skipped'; reason: string }> {
  if (!knownItemId) return createItem(ctx, write);
  try {
    await updateItem(ctx, write, knownItemId);
    return { action: write.hide ? 'archived' : 'updated', itemId: knownItemId };
  } catch (err) {
    if (httpStatusOf(err) !== 404) throw err;
  }
  ctx.index.forget(write.product.legacyId);
  if (write.hide) {
    await ctx.store.delete(write.key);
    return { action: 'skipped', reason: 'item deleted in Webflow, product inactive' };
  }
  ctx.log.warn(`item ${knownItemId} is gone from Webflow, recreating`);
  return createItem(ctx, write);
}

/** What a dry run reports it would do. */
function plannedAction(itemId: string | null, hide: boolean): SyncAction {
  if (!itemId) return 'created';
  return hide ? 'archived' : 'updated';
}

/**
 * Publishes the items written since the last flush and stores their states. A state is stored when Webflow
 * confirms the item, or reports no errors at all.
 *
 * @returns The item ids sent.
 */
export async function flushPublish(ctx: SyncContext): Promise<string[]> {
  if (!ctx.toPublish.size || ctx.dryRun) return [];
  const batch = ctx.toPublish;
  ctx.toPublish = new Map();
  const ids = [...batch.keys()];
  const results = await ctx.target.publish(ids);
  const published = new Set(results.flatMap((result) => result.publishedItemIds));
  const errors = results.flatMap((result) => result.errors);
  for (const error of errors) ctx.log.warn('publish error', JSON.stringify(error));
  for (const [itemId, { key, state }] of batch) {
    if (published.has(itemId) || (!published.size && !errors.length)) await ctx.store.put(key, state);
  }
  return ids;
}

/** Syncs one product. Publishes right away unless `publishNow` is false. */
export async function syncProduct(
  ctx: SyncContext,
  product: Product,
  { force = false, publishNow = true }: SyncProductOptions = {},
): Promise<SyncResult> {
  const { cfg, stats } = ctx;
  const hide = Boolean(product.status) && product.status !== 'ACTIVE' && cfg.inactive !== 'keep';
  const fieldData = onlyExisting(mapProduct(product, cfg), await ctx.collectionFields());
  const hashed = stableStringify({ fieldData, hide: hide ? cfg.inactive : false, owned: cfg.webflowOwned });
  const hash = toHex(await sha256(hashed));
  const key = productKey(product.id);
  const state = await readProductState(ctx.store, key);

  if (!force && state?.hash === hash) return record(stats, { action: 'unchanged', itemId: state.itemId });

  const knownItemId = state?.itemId || (await ctx.index.find(product));
  if (hide && !knownItemId) return record(stats, { action: 'skipped', reason: `status ${product.status}` });
  if (ctx.dryRun)
    return record(stats, { action: plannedAction(knownItemId, hide), itemId: knownItemId, dryRun: true, fieldData });

  const written = await writeItem(ctx, { product, fieldData, hide, key }, knownItemId);
  if (written.action === 'skipped') return record(stats, written);
  const { action, itemId } = written;
  const next = { itemId, hash, handle: product.handle, at: timestamp(ctx) };
  if (!hide && cfg.webflow.publish) {
    // The hash is stored only once the item is live, so a failed publish is retried.
    ctx.toPublish.set(itemId, { key, state: next });
    if (publishNow) await flushPublish(ctx);
  } else {
    await ctx.store.put(key, next);
  }
  ctx.log.info(`${action} ${product.handle} -> ${itemId}`);
  return record(stats, { action, itemId });
}

/**
 * The product is gone from Shopify: its item is archived, deleted or unpublished (`onDelete`).
 *
 * @param id A product gid or numeric id.
 */
export async function removeProduct(ctx: SyncContext, id: string | number): Promise<SyncResult> {
  const { cfg, stats, target } = ctx;
  const key = productKey(id);
  const state = await readProductState(ctx.store, key);
  if (state?.removed) return record(stats, { action: 'skipped', reason: 'already removed' });
  const itemId = state?.itemId || (await ctx.index.itemIdFor(numericId(id)));
  if (!itemId) return record(stats, { action: 'skipped', reason: 'no Webflow item' });
  if (ctx.dryRun)
    return record(stats, { action: cfg.onDelete === 'delete' ? 'deleted' : 'archived', itemId, dryRun: true });

  await target.unpublish(itemId);
  if (cfg.onDelete === 'delete') {
    await unlessGone(() => target.deleteItem(itemId));
    await ctx.store.delete(key);
    ctx.index.forget(numericId(id));
    ctx.log.info(`deleted item ${itemId}`);
    return record(stats, { action: 'deleted', itemId });
  }
  if (cfg.onDelete === 'archive') await unlessGone(() => target.updateItem(itemId, {}, { isArchived: true }));
  await ctx.store.put(key, { itemId, hash: null, removed: true, at: timestamp(ctx) });
  ctx.log.info(`${cfg.onDelete} item ${itemId}`);
  return record(stats, { action: 'archived', itemId });
}

/** The reason stored with a retry: the error's message, its name when it has none, or a thrown scalar. */
function retryReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return error instanceof Error ? String(error) : scalarText(error);
}

/** Remembers a product to retry on the next reconcile, after a webhook failed. */
export async function queueRetry(ctx: SyncContext, id: string | number, error: unknown): Promise<void> {
  if (ctx.dryRun) return;
  const list = await readRetries(ctx.store);
  const shopifyId = numericId(id);
  if (list.some((entry) => entry.id === shopifyId)) return;
  list.push({ id: shopifyId, attempts: 1, error: retryReason(error) });
  await ctx.store.put(RETRY_KEY, list);
}
