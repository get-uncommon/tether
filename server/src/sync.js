/**
 * The sync engine. Idempotent: the same Shopify product never causes a second
 * Webflow write, because the mapped fieldData is hashed and compared with the
 * last write (stored per product). Re-running import or reconcile is safe.
 */
import { mapProduct, withoutOwned, normalizeConfig, toSlug } from './mapping.js';
import { sha256, stableStringify, numericId, productGid, noopLogger } from './util.js';

const stateKey = (id) => `p:${numericId(id)}`;
const SINCE = 'reconcile:since';
const RETRY = 'reconcile:retry';

export function createSync({ config, shopify, webflow, store, log = noopLogger, now = () => Date.now(), dryRun = false }) {
  const cfg = config.fields && config.match?.idField && config.reconcile?.pageSize ? config : normalizeConfig(config);
  const idField = cfg.match.idField;
  let index = null; // { byId: Map, bySlug: Map, items: [] }
  let toPublish = new Set();
  let chain = Promise.resolve();
  const stats = { created: 0, updated: 0, unchanged: 0, archived: 0, deleted: 0, skipped: 0, failed: 0 };

  /** One operation at a time per sync instance: no duplicate creates from concurrent webhooks. */
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  async function getIndex() {
    if (index) return index;
    const items = await webflow.listAllItems();
    index = { items, byId: new Map(), bySlug: new Map() };
    items.forEach((it) => {
      const sid = it.fieldData?.[idField];
      if (sid && !index.byId.has(String(sid))) index.byId.set(String(sid), it);
      if (it.fieldData?.slug) index.bySlug.set(it.fieldData.slug, it);
    });
    return index;
  }

  function remember(item) {
    if (!index || !item) return;
    const sid = item.fieldData?.[idField];
    if (sid) index.byId.set(String(sid), item);
    if (item.fieldData?.slug) index.bySlug.set(item.fieldData.slug, item);
  }

  async function findItemId(product, state) {
    if (state?.itemId) return state.itemId;
    const idx = await getIndex();
    const byId = idx.byId.get(String(product.legacyId));
    if (byId) return byId.id;
    if (cfg.match.bySlug) {
      // Adopt a hand-made CMS item with the same slug, unless it belongs to another product.
      const bySlug = idx.bySlug.get(toSlug(product.handle));
      if (bySlug && !bySlug.fieldData?.[idField]) return bySlug.id;
    }
    return null;
  }

  const record = (action, extra = {}) => { stats[action] = (stats[action] || 0) + 1; return { action, ...extra }; };

  async function syncProductInner(product, { force = false, publishNow = true } = {}) {
    const inactive = product.status && product.status !== 'ACTIVE';
    const hide = inactive && cfg.inactive !== 'keep';
    const fieldData = mapProduct(product, cfg);
    const hash = await sha256(stableStringify({ fieldData, hide: hide ? cfg.inactive : false, owned: cfg.webflowOwned }));
    const key = stateKey(product.id);
    const state = await store.get(key);

    if (!force && state?.hash === hash) return record('unchanged', { itemId: state.itemId });

    let itemId = await findItemId(product, state);

    if (hide && !itemId) return record('skipped', { reason: `status ${product.status}` });
    if (dryRun) return record(itemId ? (hide ? 'archived' : 'updated') : 'created', { itemId, dryRun: true, fieldData });

    let action;
    if (itemId) {
      const flags = hide && cfg.inactive === 'archive' ? { isArchived: true, isDraft: false } : { isArchived: false, isDraft: false };
      if (hide) await webflow.unpublish(itemId);
      try {
        const item = await webflow.updateItem(itemId, withoutOwned(fieldData, cfg), flags);
        remember(item);
      } catch (err) {
        if (err.status !== 404) throw err;
        // Deleted in Webflow by hand: forget it and create a fresh item below.
        log.warn(`item ${itemId} is gone from Webflow, recreating`);
        itemId = null;
      }
      action = hide ? 'archived' : 'updated';
    }
    if (!itemId) {
      const item = await webflow.createItem(fieldData, { isDraft: false, isArchived: false });
      itemId = item.id;
      remember(item);
      action = 'created';
    }

    if (!hide && cfg.webflow.publish) {
      toPublish.add(itemId);
      if (publishNow) await flushPublish();
    }
    await store.put(key, { itemId, hash, handle: product.handle, at: new Date(now()).toISOString() });
    log.info(`${action} ${product.handle} -> ${itemId}`);
    return record(action, { itemId });
  }

  async function flushPublish() {
    if (!toPublish.size || dryRun) return [];
    const ids = [...toPublish];
    toPublish = new Set();
    const results = await webflow.publish(ids);
    results.forEach((r) => (r?.errors || []).forEach((e) => log.warn('publish error', JSON.stringify(e))));
    return ids;
  }

  async function removeInner(id) {
    const key = stateKey(id);
    const state = await store.get(key);
    let itemId = state?.itemId;
    if (!itemId) itemId = (await getIndex()).byId.get(String(numericId(id)))?.id || null;
    if (!itemId) return record('skipped', { reason: 'no Webflow item' });
    if (dryRun) return record(cfg.onDelete === 'delete' ? 'deleted' : 'archived', { itemId, dryRun: true });

    await webflow.unpublish(itemId);
    if (cfg.onDelete === 'delete') {
      try { await webflow.deleteItem(itemId); } catch (err) { if (err.status !== 404) throw err; }
      await store.delete(key);
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

    flushPublish: () => serial(flushPublish),

    /**
     * Products updated since the last run (cursor in the store). Stops after
     * maxChanges Webflow writes and continues from there next run, so it fits
     * in a Worker's subrequest limit.
     */
    reconcile: ({ maxChanges = cfg.reconcile.maxChangesPerRun, since: sinceOverride } = {}) => serial(async () => {
      const start = sinceOverride || (await store.get(SINCE)) || new Date(now() - cfg.reconcile.lookbackMinutes * 60000).toISOString();
      const retry = (await store.get(RETRY)) || [];
      const failures = [];
      let changes = 0;
      let processed = 0;
      let newest = start;
      let complete = true;

      // Products that failed last time first.
      for (const r of retry) {
        try {
          const product = await shopify.getProduct(productGid(r.id));
          const res = product ? await syncProductInner(product, { publishNow: false }) : await removeInner(r.id);
          if (res.action !== 'unchanged' && res.action !== 'skipped') changes++;
        } catch (err) {
          if ((r.attempts || 1) < 5) failures.push({ id: r.id, attempts: (r.attempts || 1) + 1, error: err.message });
          else log.error(`giving up on product ${r.id}: ${err.message}`);
        }
      }

      let after = null;
      outer: for (;;) {
        const page = await shopify.listProducts({ first: cfg.reconcile.pageSize, after, query: `updated_at:>='${start}'` });
        for (const product of page.products) {
          if (changes >= maxChanges) { complete = false; break outer; }
          processed++;
          try {
            const res = await syncProductInner(product, { publishNow: false });
            if (res.action !== 'unchanged' && res.action !== 'skipped') changes++;
          } catch (err) {
            stats.failed++;
            log.error(`sync ${product.handle} failed: ${err.message}`);
            failures.push({ id: numericId(product.id), attempts: 1, error: err.message });
          }
          if (product.updatedAt > newest) newest = product.updatedAt;
        }
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }

      await flushPublish();
      if (!dryRun) {
        // Only write when it moved: KV free tier allows 1,000 writes a day.
        if ((await store.get(SINCE)) !== newest) await store.put(SINCE, newest);
        if (failures.length || retry.length) await store.put(RETRY, failures);
      }
      return { since: start, until: newest, processed, changes, complete, failures, stats: { ...stats } };
    }),

    /**
     * Every product. prune: archive/delete Webflow items whose Shopify product
     * no longer exists. Sets the reconcile cursor, so reconcile picks up from here.
     */
    importAll: ({ prune = false, force = false, query = cfg.shopify.query || null, onProgress } = {}) => serial(async () => {
      const seen = new Set();
      const failures = [];
      let newest = null;
      let after = null;
      let n = 0;
      for (;;) {
        const page = await shopify.listProducts({ first: cfg.reconcile.pageSize, after, query });
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
        const idx = await getIndex();
        for (const item of idx.items) {
          const sid = item.fieldData?.[idField];
          if (sid && !seen.has(String(sid)) && !item.isArchived) {
            pruned.push({ itemId: item.id, shopifyId: sid, slug: item.fieldData.slug });
            await removeInner(sid);
          }
        }
      } else if (prune) log.warn('prune skipped: it needs a full import (no shopify.query filter)');

      if (!dryRun && newest) await store.put(SINCE, newest);
      return { products: n, failures, pruned, stats: { ...stats } };
    }),
  };
  return api;
}
