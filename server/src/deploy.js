/**
 * Rebuild-on-change for statically built sites (Astro, Eleventy, ...): when a product's content
 * changes in Shopify, call the site's deploy hook (Cloudflare Pages, Netlify, Vercel, any URL
 * that starts a build). At most one build per DEPLOY_HOOK_MIN_SECONDS (default 60); changes in
 * between wait for the next webhook or cron run, so a bulk edit gives one build.
 *
 * It plugs into the normal sync engine as a "Webflow" that stores nothing: the engine's change
 * detection (hash per product), cursor, retries and budgets all apply. Next to Webflow it wraps
 * the real Webflow client and also triggers a build after each Webflow change.
 */

// What a statically built product page shows. Stock and availability are left out on purpose:
// Tether updates them live in the browser, a rebuild for every sale would be wasteful.
export const DEPLOY_FIELDS = {
  name: 'title',
  slug: 'handle',
  'shopify-id': 'legacyId',
  description: 'descriptionHtml',
  vendor: 'vendor',
  'product-type': 'productType',
  tags: 'tagsText',
  price: 'price',
  'max-price': 'maxPrice',
  'compare-at-price': 'compareAtPrice',
  image: 'image',
  images: 'images',
  'seo-title': 'seoTitle',
  'seo-description': 'seoDescription',
  options: 'options',
  variants: (p) => p.variants.map((v) => ({ id: v.id, title: v.title, price: v.price, compareAtPrice: v.compareAtPrice, sku: v.sku })),
  metafields: 'metafields',
};

const KEY = 'deploy:state'; // { dirty, lastAt }

export function createDeployHook({ url, minIntervalSeconds = 60, store, fetch: fetchImpl = globalThis.fetch, now = () => Date.now(), log }) {
  let dirty = false; // changed during this run (written to the store once, in maybeTrigger)

  const markDirty = () => { dirty = true; };

  /** Trigger a build if something changed (now or in an earlier run) and the interval passed. */
  async function maybeTrigger({ force = false } = {}) {
    const state = (await store.get(KEY)) || { dirty: false, lastAt: 0 };
    const pending = dirty || state.dirty || force;
    dirty = false;
    if (!pending) return { triggered: false };
    const wait = state.lastAt + minIntervalSeconds * 1000 - now();
    if (wait > 0 && !force) {
      if (!state.dirty) await store.put(KEY, { ...state, dirty: true });
      log?.info?.(`deploy hook: change noted, next build in ${Math.ceil(wait / 1000)}s or later`);
      return { triggered: false, pending: true, waitMs: wait };
    }
    let res;
    try { res = await fetchImpl(url, { method: 'POST' }); } catch (err) {
      await store.put(KEY, { ...state, dirty: true }); // network error: keep the build pending for the next run
      throw err;
    }
    if (!res.ok) {
      await store.put(KEY, { ...state, dirty: true });
      throw new Error(`deploy hook answered ${res.status}`);
    }
    await store.put(KEY, { dirty: false, lastAt: now() });
    log?.info?.('deploy hook: build started');
    return { triggered: true };
  }

  return { markDirty, maybeTrigger, url };
}

/** A Webflow client stand-in: stores nothing, marks a build as needed on every change. */
export function deployOnlyTarget(hook) {
  return {
    collectionId: 'deploy-hook',
    requests: 0,
    getCollection: async () => ({ displayName: 'deploy hook', fields: [] }),
    listAllItems: async () => [],
    getItem: async () => null,
    createItem: async (fieldData) => { hook.markDirty(); return { id: `site:${fieldData['shopify-id'] || fieldData.slug}`, fieldData }; },
    updateItem: async (id, fieldData) => { hook.markDirty(); return { id, fieldData }; },
    deleteItem: async () => { hook.markDirty(); return null; },
    publish: async (ids) => [{ publishedItemIds: ids, errors: [] }],
    unpublish: async () => { hook.markDirty(); return null; },
  };
}

/** Real Webflow client + a build after each Webflow change (Webflow and a static site together). */
export function withDeployHook(webflow, hook) {
  const wrap = (fn) => async (...args) => { const r = await fn(...args); hook.markDirty(); return r; };
  return { ...webflow, createItem: wrap(webflow.createItem), updateItem: wrap(webflow.updateItem), deleteItem: wrap(webflow.deleteItem), unpublish: wrap(webflow.unpublish) };
}
