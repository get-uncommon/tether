/**
 * One product's sync and removal, the operations every engine entry point is built from. Idempotent: the mapped
 * fieldData is hashed and compared with the last *published* write, so the same Shopify product never causes a
 * second Webflow write.
 */
import { mapProduct, withoutOwned, onlyExisting } from './mapping.js';
import { readProductState, readRetries, productKey, RETRY_KEY } from './sync-state.js';
import { SyncError, httpStatusOf, numericId, scalarText, sha256, stableStringify } from './util.js';

/** @typedef {import('./item-index.js').ItemIndex} ItemIndex */
/** @typedef {import('./mapping.js').FieldData} FieldData */
/** @typedef {import('./mapping.js').Product} Product */
/** @typedef {import('./mapping.js').SyncConfig} SyncConfig */
/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./sync-state.js').ProductState} ProductState */
/** @typedef {import('./util.js').Logger} Logger */
/** @typedef {import('./webflow.js').CmsTarget} CmsTarget */

/** @typedef {'created' | 'updated' | 'unchanged' | 'archived' | 'deleted' | 'skipped'} SyncAction */
/** @typedef {Record<SyncAction | 'failed', number>} SyncStats Counts for the engine's lifetime. */

/**
 * What one product's sync did. `reason` says why a product was skipped; a dry run reports the action it would take.
 *
 * @typedef {{ action: SyncAction, itemId: string, reason?: undefined }
 *   | { action: 'skipped', reason: string, itemId?: undefined }
 *   | { action: SyncAction, itemId: string | null, dryRun: true, fieldData?: FieldData, reason?: undefined }} SyncResult
 */

/**
 * What the engine's operations share. `toPublish` holds the states to store once their items are live.
 *
 * @typedef {object} SyncContext
 * @property {SyncConfig} cfg
 * @property {CmsTarget} target
 * @property {Store} store
 * @property {Logger} log
 * @property {() => number} now
 * @property {boolean} dryRun Reads everything, writes nothing.
 * @property {ItemIndex} index
 * @property {SyncStats} stats
 * @property {Map<string, { key: string, state: ProductState }>} toPublish
 * @property {() => Promise<Set<string> | null>} collectionFields The collection's field slugs with
 *   `webflow.skipMissingFields`, or `null` to write every mapped field.
 */

/** @typedef {{ force?: boolean, publishNow?: boolean }} SyncProductOptions */

/**
 * @template {SyncResult} R
 * @param {SyncStats} stats
 * @param {R} result
 * @returns {R}
 */
function record(stats, result) {
  stats[result.action] += 1;
  return result;
}

/** @param {SyncContext} ctx */
const timestamp = (ctx) => new Date(ctx.now()).toISOString();

/** Webflow slugs are unique: a create for a slug another item holds is refused. @param {unknown} error */
function isSlugConflict(error) {
  if (!(error instanceof SyncError) || (error.status !== 400 && error.status !== 409)) return false;
  return /slug|unique|already/i.test(`${error.message} ${JSON.stringify(error.body || '')}`);
}

/**
 * Runs a write on an item that may have been deleted in Webflow by hand; for a deletion or an archive that is the
 * outcome wanted anyway.
 *
 * @param {() => Promise<unknown>} write
 */
async function unlessGone(write) {
  try {
    await write();
  } catch (err) {
    if (httpStatusOf(err) !== 404) throw err;
  }
}

/**
 * @typedef {object} ItemWrite
 * @property {Product} product
 * @property {FieldData} fieldData
 * @property {boolean} hide The product is inactive and `inactive` is not `keep`.
 * @property {string} key
 */

/**
 * @param {SyncContext} ctx
 * @param {ItemWrite} write
 * @param {string} itemId
 */
async function updateItem(ctx, { fieldData, hide }, itemId) {
  if (hide) await ctx.target.unpublish(itemId);
  const flags = { isArchived: hide && ctx.cfg.inactive === 'archive', isDraft: false };
  await ctx.target.updateItem(itemId, withoutOwned(fieldData, ctx.cfg), flags);
  ctx.index.remember(itemId, fieldData);
}

/**
 * Creates the item. When the slug is taken, a concurrent run (create and update webhooks for a new product) or a
 * stale index lost the race: the item that won is updated instead.
 *
 * @param {SyncContext} ctx
 * @param {ItemWrite} write
 * @returns {Promise<{ action: 'created' | 'updated', itemId: string }>}
 */
async function createItem(ctx, write) {
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

/**
 * Updates the known item, or creates one when there is none or it was deleted in Webflow by hand.
 *
 * @param {SyncContext} ctx
 * @param {ItemWrite} write
 * @param {string | null} knownItemId
 * @returns {Promise<{ action: 'created' | 'updated' | 'archived', itemId: string } | { action: 'skipped', reason: string }>}
 */
async function writeItem(ctx, write, knownItemId) {
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

/**
 * What a dry run reports it would do.
 *
 * @param {string | null} itemId
 * @param {boolean} hide
 * @returns {SyncAction}
 */
function plannedAction(itemId, hide) {
  if (!itemId) return 'created';
  return hide ? 'archived' : 'updated';
}

/**
 * Publishes the items written since the last flush and stores their states. A state is stored when Webflow
 * confirms the item, or reports no errors at all.
 *
 * @param {SyncContext} ctx
 * @returns {Promise<string[]>} The item ids sent.
 */
export async function flushPublish(ctx) {
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

/**
 * Syncs one product. Publishes right away unless `publishNow` is false.
 *
 * @param {SyncContext} ctx
 * @param {Product} product
 * @param {SyncProductOptions} [options]
 * @returns {Promise<SyncResult>}
 */
export async function syncProduct(ctx, product, { force = false, publishNow = true } = {}) {
  const { cfg, stats } = ctx;
  const hide = Boolean(product.status) && product.status !== 'ACTIVE' && cfg.inactive !== 'keep';
  const fieldData = onlyExisting(mapProduct(product, cfg), await ctx.collectionFields());
  const hash = await sha256(stableStringify({ fieldData, hide: hide ? cfg.inactive : false, owned: cfg.webflowOwned }));
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
 * @param {SyncContext} ctx
 * @param {string | number} id A product gid or numeric id.
 * @returns {Promise<SyncResult>}
 */
export async function removeProduct(ctx, id) {
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

/**
 * The reason stored with a retry: the error's message, its name when it has none, or a thrown scalar.
 *
 * @param {unknown} error
 */
function retryReason(error) {
  if (error instanceof Error && error.message) return error.message;
  return error instanceof Error ? String(error) : scalarText(error);
}

/**
 * Remembers a product to retry on the next reconcile, after a webhook failed.
 *
 * @param {SyncContext} ctx
 * @param {string | number} id
 * @param {unknown} error
 */
export async function queueRetry(ctx, id, error) {
  if (ctx.dryRun) return;
  const list = await readRetries(ctx.store);
  const shopifyId = numericId(id);
  if (list.some((entry) => entry.id === shopifyId)) return;
  list.push({ id: shopifyId, attempts: 1, error: retryReason(error) });
  await ctx.store.put(RETRY_KEY, list);
}
