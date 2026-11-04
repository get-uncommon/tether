/**
 * The sync engine. Idempotent: the same Shopify product never causes a second
 * Webflow write, because the mapped fieldData is hashed and compared with the
 * last *published* write (stored per product). Re-running import or reconcile is safe.
 *
 * Budgets: a run stops before it runs out of subrequests (Cloudflare free plan: 50) and
 * saves exactly where it was, so the next run continues there.
 */
import { mapProduct, withoutOwned, normalizeConfig, toSlug, onlyExisting } from './mapping.js';
import { sha256, stableStringify, numericId, productGid, noopLogger } from './util.js';

const stateKey = (id) => `p:${numericId(id)}`;
const SINCE = 'reconcile:since';
const PAGE = 'reconcile:page';   // { since, after, offset, newest } while a reconcile window is half done
const RETRY = 'reconcile:retry';
const INDEX = 'index';           // { at, byId: { shopifyId: itemId }, bySlug: { slug: [itemId, shopifyId] } }

const isSlugConflict = (err) => (err.status === 400 || err.status === 409) && /slug|unique|already/i.test(`${err.message} ${JSON.stringify(err.body || '')}`);

export function createSync({
  config, shopify, webflow, store, log = noopLogger, now = () => Date.now(), dryRun = false,
  budget = null, // { left(): number } remaining subrequests, or null for no limit
}) {
  const cfg = config.fields && config.match?.idField && config.reconcile?.maxProductsPerRun ? config : normalizeConfig(config);
  const idField = cfg.match.idField;
  let index = null;        // { byId: Map, bySlug: Map, items?: [] }
  let indexDirty = false;
  let fieldSlugs = null;   // Set of collection field slugs (skipMissingFields)
  let toPublish = new Map(); // itemId -> state to commit once published
  let chain = Promise.resolve();
  const stats = { created: 0, updated: 0, unchanged: 0, archived: 0, deleted: 0, skipped: 0, failed: 0 };
  const reserve = cfg.reconcile.reserveSubrequests;
  const outOfBudget = () => Boolean(budget) && budget.left() < reserve;

  /** One operation at a time per sync instance. */
  const serial = (fn) => {
    const run = chain.then(fn, fn).finally(saveIndex);
    chain = run.catch(() => {});
    return run;
  };

  async function collectionFields() {
    if (!cfg.webflow.skipMissingFields) return null;
    if (!fieldSlugs) {
      const col = await webflow.getCollection();
      fieldSlugs = new Set((col.fields || []).map((f) => f.slug));
      const dropped = Object.keys(cfg.fields).filter((k) => k !== 'name' && k !== 'slug' && !fieldSlugs.has(k));
      if (dropped.length) log.debug?.(`not in the collection, skipped: ${dropped.join(', ')}`);
    }
    return fieldSlugs;
  }

  // ------------------------------------------------------------ item index
  // Maps Shopify ids and slugs to Webflow items. Listing a collection costs one request per
  // 100 items, so the map is cached in the store (indexTtlMinutes) and only refreshed when stale.

  async function getIndex({ fresh = false } = {}) {
    if (index && (!fresh || index.items)) return index;
    if (!fresh && !index) {
      const cached = await store.get(INDEX);
      if (cached && now() - Date.parse(cached.at) < cfg.match.indexTtlMinutes * 60000) {
        index = { byId: new Map(Object.entries(cached.byId)), bySlug: new Map(Object.entries(cached.bySlug)), at: cached.at };
        return index;
      }
    }
    const items = await webflow.listAllItems();
    index = { items, byId: new Map(), bySlug: new Map(), at: new Date(now()).toISOString() };
    items.forEach((it) => {
      const sid = it.fieldData?.[idField];
      if (sid && !index.byId.has(String(sid))) index.byId.set(String(sid), it.id);
      if (it.fieldData?.slug) index.bySlug.set(it.fieldData.slug, [it.id, sid ? String(sid) : null]);
    });
    indexDirty = true;
    return index;
  }

  function remember(itemId, fieldData) {
    if (!index || !itemId) return;
    const sid = fieldData?.[idField];
    if (sid) index.byId.set(String(sid), itemId);
    if (fieldData?.slug) index.bySlug.set(fieldData.slug, [itemId, sid ? String(sid) : null]);
    indexDirty = true;
  }

  async function saveIndex() {
    if (!indexDirty || dryRun || !index) return;
    indexDirty = false;
    await store.put(INDEX, { at: index.at, byId: Object.fromEntries(index.byId), bySlug: Object.fromEntries(index.bySlug) });
  }

  async function findItemId(product, state, opts) {
    if (state?.itemId) return state.itemId;
    const idx = await getIndex(opts);
    const byId = idx.byId.get(String(product.legacyId));
    if (byId) return byId;
    if (cfg.match.bySlug) {
      // Adopt a hand-made CMS item with the same slug, unless it belongs to another product.
      const hit = idx.bySlug.get(toSlug(product.handle));
      if (hit && !hit[1]) return hit[0];
    }
    return null;
  }

  const record = (action, extra = {}) => { stats[action] = (stats[action] || 0) + 1; return { action, ...extra }; };

  // ------------------------------------------------------------ one product

  async function syncProductInner(product, { force = false, publishNow = true } = {}) {
    const inactive = product.status && product.status !== 'ACTIVE';
    const hide = inactive && cfg.inactive !== 'keep';
    const fieldData = onlyExisting(mapProduct(product, cfg), await collectionFields());
    const hash = await sha256(stableStringify({ fieldData, hide: hide ? cfg.inactive : false, owned: cfg.webflowOwned }));
    const key = stateKey(product.id);
    const state = await store.get(key);

    if (!force && state?.hash === hash) return record('unchanged', { itemId: state.itemId });

    let itemId = await findItemId(product, state);

    if (hide && !itemId) return record('skipped', { reason: `status ${product.status}` });
    if (dryRun) return record(itemId ? (hide ? 'archived' : 'updated') : 'created', { itemId, dryRun: true, fieldData });

    const update = async (id) => {
      const flags = hide && cfg.inactive === 'archive' ? { isArchived: true, isDraft: false } : { isArchived: false, isDraft: false };
      if (hide) await webflow.unpublish(id);
      await webflow.updateItem(id, withoutOwned(fieldData, cfg), flags);
      remember(id, fieldData);
    };

    let action;
    if (itemId) {
      try {
        await update(itemId);
        action = hide ? 'archived' : 'updated';
      } catch (err) {
        if (err.status !== 404) throw err;
        // Deleted in Webflow by hand.
        if (index) index.byId.delete(String(product.legacyId));
        if (hide) { await store.delete(key); return record('skipped', { reason: 'item deleted in Webflow, product inactive' }); }
        log.warn(`item ${itemId} is gone from Webflow, recreating`);
        itemId = null;
      }
    }
    if (!itemId) {
      try {
        const item = await webflow.createItem(fieldData, { isDraft: false, isArchived: false });
        itemId = item.id;
        action = 'created';
        remember(itemId, fieldData);
        // Remember the item right away, before publishing: a crash or a concurrent
        // webhook must find it instead of creating another one.
        await store.put(key, { itemId, hash: null, handle: product.handle, at: new Date(now()).toISOString() });
      } catch (err) {
        if (!isSlugConflict(err)) throw err;
        // Webflow slugs are unique, so a concurrent run (create + update webhooks for a new
        // product) or a stale index lost the race: find the item that won and update it.
        const winner = (await store.get(key))?.itemId || (await findItemId(product, null, { fresh: true }));
        if (!winner) throw err;
        await update(winner);
        itemId = winner;
        action = 'updated';
      }
    }

    const next = { itemId, hash, handle: product.handle, at: new Date(now()).toISOString() };
    if (!hide && cfg.webflow.publish) {
      // The hash is stored only once the item is live, so a failed publish is retried.
      toPublish.set(itemId, { key, state: next });
      if (publishNow) await flushPublish();
    } else {
      await store.put(key, next);
    }
    log.info(`${action} ${product.handle} -> ${itemId}`);
    return record(action, { itemId });
  }

  async function flushPublish() {
    if (!toPublish.size || dryRun) return [];
    const batch = toPublish;
    toPublish = new Map();
    const ids = [...batch.keys()];
    const results = await webflow.publish(ids);
    const published = new Set(results.flatMap((r) => r?.publishedItemIds || []));
    const errors = results.flatMap((r) => r?.errors || []);
    errors.forEach((e) => log.warn('publish error', JSON.stringify(e)));
    for (const [itemId, { key, state }] of batch) {
      // Commit when Webflow confirms it, or when it reported no errors at all.
      if (published.has(itemId) || (!published.size && !errors.length)) await store.put(key, state);
    }
    return ids;
  }

  async function removeInner(id) {
    const key = stateKey(id);
    const state = await store.get(key);
    if (state?.removed) return record('skipped', { reason: 'already removed' });
    let itemId = state?.itemId;
    if (!itemId) itemId = (await getIndex()).byId.get(String(numericId(id))) || null;
    if (!itemId) return record('skipped', { reason: 'no Webflow item' });
    if (dryRun) return record(cfg.onDelete === 'delete' ? 'deleted' : 'archived', { itemId, dryRun: true });

    await webflow.unpublish(itemId);
    if (cfg.onDelete === 'delete') {
      try { await webflow.deleteItem(itemId); } catch (err) { if (err.status !== 404) throw err; }
      await store.delete(key);
      if (index) { index.byId.delete(String(numericId(id))); indexDirty = true; }
      log.info(`deleted item ${itemId}`);
      return record('deleted', { itemId });
    }
    if (cfg.onDelete === 'archive') {
      try { await webflow.updateItem(itemId, {}, { isArchived: true }); } catch (err) { if (err.status !== 404) throw err; }
    }
    await store.put(key, { itemId, hash: null, removed: true, at: new Date(now()).toISOString() });
    log.info(`${cfg.onDelete} item ${itemId}`);
    return record('archived', { itemId });
  }

  /** Remember a product to retry on the next reconcile (e.g. a webhook that failed). */
  async function queueRetry(id, error) {
    if (dryRun) return;
    const list = (await store.get(RETRY)) || [];
    const nid = numericId(id);
    if (list.some((r) => r.id === nid)) return;
    list.push({ id: nid, attempts: 1, error: String(error?.message || error || '') });
    await store.put(RETRY, list);
  }

  const isoMinus = (iso, minutes) => new Date(Date.parse(iso) - minutes * 60000).toISOString().replace('.000Z', 'Z');

  const api = {
    config: cfg,
    stats,

    /** Sync one product (normalized). Publishes right away unless publishNow is false. */
    syncProduct: (product, opts) => serial(() => syncProductInner(product, opts)),

    /** Fetch the current product from Shopify, then sync or remove it. Used by webhooks. */
    syncById: (id) => serial(async () => {
      const product = await shopify.getProduct(productGid(id));
      if (!product) return removeInner(id);
      return syncProductInner(product);
    }),

    /** Product deleted in Shopify. */
    removeProduct: (id) => serial(() => removeInner(id)),

    queueRetry: (id, error) => serial(() => queueRetry(id, error)),

    flushPublish: () => serial(flushPublish),

    /**
     * Products updated since the last run. Stops at the first budget it hits (Webflow
     * writes, products, Shopify pages, subrequests) and saves its exact position, so the
     * next run continues there. The window overlaps the previous one by a few minutes,
     * because Shopify's search index lags slightly behind updates.
     */
    reconcile: ({
      maxChanges = cfg.reconcile.maxChangesPerRun,
      maxProducts = cfg.reconcile.maxProductsPerRun,
      maxPages = cfg.reconcile.maxPagesPerRun,
      since: sinceOverride,
    } = {}) => serial(async () => {
      const storedSince = await store.get(SINCE);
      // A half-done window (also one started with `since`, e.g. a first import) is finished first.
      const resume = sinceOverride ? null : await store.get(PAGE);
      const start = sinceOverride || resume?.since || storedSince || new Date(now() - cfg.reconcile.lookbackMinutes * 60000).toISOString();
      const resuming = Boolean(resume) && resume.since === start;
      let after = resuming ? resume.after : null;
      let offset = resuming ? resume.offset || 0 : 0; // products of that page already done
      let newest = resuming ? resume.newest : start;
      const retry = (await store.get(RETRY)) || [];
      const failures = [];
      let changes = 0;
      let processed = 0;
      let pages = 0;
      let complete = true;
      let stopped = null;
      const stop = (why) => { complete = false; stopped = why; };
      const counts = (res) => res.action !== 'unchanged' && res.action !== 'skipped';

      // Products that failed before (webhooks or earlier runs) first.
      const retryLeft = [];
      for (const r of retry) {
        if (outOfBudget() || changes >= maxChanges) { retryLeft.push(r); continue; }
        try {
          const product = await shopify.getProduct(productGid(r.id));
          const res = product ? await syncProductInner(product, { publishNow: false }) : await removeInner(r.id);
          if (counts(res)) changes++;
        } catch (err) {
          if ((r.attempts || 1) < 5) failures.push({ id: r.id, attempts: (r.attempts || 1) + 1, error: err.message });
          else log.error(`giving up on product ${r.id}: ${err.message}`);
        }
      }

      const query = `updated_at:>='${isoMinus(start, cfg.reconcile.overlapMinutes)}'`;
      outer: for (;;) {
        if (pages >= maxPages) { stop('pages'); break; }
        if (outOfBudget()) { stop('subrequests'); break; }
        let page;
        try {
          page = await shopify.listProducts({ after, query });
        } catch (err) {
          log.error(`listing products failed: ${err.message}`);
          stop('error');
          failures.push({ id: null, error: err.message });
          break;
        }
        pages++;
        for (let i = offset; i < page.products.length; i++) {
          const product = page.products[i];
          // Stopping mid-page: remember how far into this page we got.
          if (changes >= maxChanges) { offset = i; stop('changes'); break outer; }
          if (processed >= maxProducts) { offset = i; stop('products'); break outer; }
          if (outOfBudget()) { offset = i; stop('subrequests'); break outer; }
          processed++;
          try {
            if (counts(await syncProductInner(product, { publishNow: false }))) changes++;
          } catch (err) {
            stats.failed++;
            log.error(`sync ${product.handle} failed: ${err.message}`);
            failures.push({ id: numericId(product.id), attempts: 1, error: err.message });
          }
          if (product.updatedAt > newest) newest = product.updatedAt;
        }
        offset = 0;
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }

      try { await flushPublish(); } catch (err) {
        log.error(`publish failed: ${err.message}`); // hashes weren't stored: retried next run
        stop('publish');
      }

      if (!dryRun) {
        // Only write what moved: KV's free tier allows 1,000 writes a day.
        if (complete) {
          if (storedSince !== newest) await store.put(SINCE, newest);
          if (resume || sinceOverride) await store.delete(PAGE);
        } else if (!resuming || resume.after !== after || resume.offset !== offset || resume.newest !== newest) {
          await store.put(PAGE, { since: start, after, offset, newest });
        }
        const nextRetry = [...retryLeft, ...failures.filter((f) => f.id)];
        if (nextRetry.length || retry.length) await store.put(RETRY, nextRetry);
      }
      return { since: start, until: newest, processed, pages, changes, complete, stopped, failures, stats: { ...stats } };
    }),

    /**
     * Every product. prune: archive/delete Webflow items whose Shopify product
     * no longer exists. Sets the reconcile cursor, so reconcile picks up from here.
     * Meant for the Node CLI (no subrequest budget).
     */
    importAll: ({ prune = false, force = false, query = cfg.shopify.query || null, onProgress } = {}) => serial(async () => {
      const seen = new Set();
      const failures = [];
      let newest = null;
      let after = null;
      let n = 0;
      for (;;) {
        const page = await shopify.listProducts({ after, query });
        for (const product of page.products) {
          seen.add(String(product.legacyId));
          try { await syncProductInner(product, { force, publishNow: false }); } catch (err) {
            stats.failed++;
            failures.push({ id: product.legacyId, handle: product.handle, error: err.message });
            log.error(`sync ${product.handle} failed: ${err.message}`);
          }
          if (!newest || product.updatedAt > newest) newest = product.updatedAt;
          n++;
          if (onProgress) onProgress(n, product);
        }
        // Publish in batches as we go, so a crash halfway leaves published items behind.
        if (toPublish.size >= 100) await flushPublish();
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }
      await flushPublish();

      const pruned = [];
      if (prune && !query) {
        const idx = await getIndex({ fresh: true });
        for (const item of idx.items) {
          const sid = item.fieldData?.[idField];
          if (!sid || seen.has(String(sid)) || item.isArchived) continue;
          const res = await removeInner(sid);
          if (res.action !== 'skipped') pruned.push({ itemId: item.id, shopifyId: sid, slug: item.fieldData.slug });
        }
      } else if (prune) log.warn('prune skipped: it needs a full import (no shopify.query filter)');

      if (!dryRun && newest) await store.put(SINCE, newest);
      return { products: n, failures, pruned, stats: { ...stats } };
    }),
  };
  return api;
}
