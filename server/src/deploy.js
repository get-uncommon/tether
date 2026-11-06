/**
 * Rebuild-on-change for statically built sites: when a product's content changes in Shopify, call the site's deploy
 * hook (any URL that starts a build when POSTed to). At most one build per DEPLOY_HOOK_MIN_SECONDS (default 60);
 * changes in between wait for the next webhook or cron run, so a bulk edit gives one build.
 *
 * Without Webflow it plugs into the sync engine as a CMS target that stores nothing, so the engine's change
 * detection (hash per product), cursor, retries and budgets all apply. Next to Webflow it wraps the real Webflow
 * client and also triggers a build after each Webflow change.
 */
import { isRecord, noopLogger } from './util.js';

/** @typedef {import('./mapping.js').FieldSource} FieldSource */
/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./util.js').Logger} Logger */
/** @typedef {import('./webflow.js').CmsTarget} CmsTarget */
/** @typedef {import('./webflow.js').WebflowClient} WebflowClient */

/**
 * What a statically built product page shows. Stock and availability are left out on purpose: Tether updates them
 * live in the browser, and a rebuild for every sale would be wasteful.
 *
 * @type {Record<string, FieldSource>}
 */
export const DEPLOY_FIELDS = {
  name: 'title',
  slug: 'handle',
  'shopify-id': 'legacyId',
  // Only hashed, to notice a change: the site's build reads the description from the Storefront API itself, and
  // cleans it there (docs/astro.md).
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
  variants: (product) =>
    product.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      sku: variant.sku,
    })),
  metafields: 'metafields',
};

/** The collection id a deploy-only target reports, in `app.config` and `app.webflow`: there is no collection. */
export const DEPLOY_ONLY_COLLECTION_ID = 'deploy-hook';

/** A build that is still owed survives in the store between runs. */
const KEY = 'deploy:state';
const DEFAULT_MIN_INTERVAL_SECONDS = 60;

/** @typedef {{ dirty: boolean, lastAt: number }} DeployState */

/**
 * @typedef {{ triggered: true }
 *   | { triggered: false }
 *   | { triggered: false, pending: true, waitMs: number }} DeployOutcome
 */

/**
 * @typedef {object} DeployHook
 * @property {() => void} markDirty Notes a change in this run; {@link DeployHook.maybeTrigger} acts on it.
 * @property {(options?: { force?: boolean }) => Promise<DeployOutcome>} maybeTrigger Starts a build if something
 *   changed, in this run or an earlier one, and the interval has passed. Rejects when the hook fails; the build
 *   stays owed for the next run.
 * @property {string} url
 */

/** @param {unknown} value @returns {DeployState} */
function parseDeployState(value) {
  if (!isRecord(value)) return { dirty: false, lastAt: 0 };
  const { dirty, lastAt } = value;
  return { dirty: Boolean(dirty), lastAt: typeof lastAt === 'number' ? lastAt : 0 };
}

/**
 * @param {object} options
 * @param {string} options.url
 * @param {number} [options.minIntervalSeconds]
 * @param {Store} options.store
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @param {Logger} [options.log]
 * @returns {DeployHook}
 */
export function createDeployHook({
  url,
  minIntervalSeconds = DEFAULT_MIN_INTERVAL_SECONDS,
  store,
  fetch: fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  log = noopLogger,
}) {
  // Changed during this run. Written to the store once, in maybeTrigger, to save KV writes.
  let dirty = false;

  const markDirty = () => {
    dirty = true;
  };

  /** @type {DeployHook['maybeTrigger']} */
  async function maybeTrigger({ force = false } = {}) {
    const state = parseDeployState(await store.get(KEY));
    const pending = dirty || state.dirty || force;
    dirty = false;
    if (!pending) return { triggered: false };
    const waitMs = state.lastAt + minIntervalSeconds * 1000 - now();
    if (waitMs > 0 && !force) {
      if (!state.dirty) await store.put(KEY, { ...state, dirty: true });
      log.info(`deploy hook: change noted, next build in ${Math.ceil(waitMs / 1000)}s or later`);
      return { triggered: false, pending: true, waitMs };
    }
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST' });
    } catch (err) {
      // A network error: the build stays owed for the next run.
      await store.put(KEY, { ...state, dirty: true });
      throw err;
    }
    if (!res.ok) {
      await store.put(KEY, { ...state, dirty: true });
      throw new Error(`deploy hook answered ${res.status}`);
    }
    await store.put(KEY, { dirty: false, lastAt: now() });
    log.info('deploy hook: build started');
    return { triggered: true };
  }

  return { markDirty, maybeTrigger, url };
}

/**
 * @typedef {CmsTarget & {
 *   collectionId: string,
 *   requests: number,
 *   getItem: () => Promise<null>,
 * }} DeployOnlyTarget
 */

/**
 * A CMS target that stores nothing and marks a build as needed on every change.
 *
 * @param {DeployHook} hook
 * @returns {DeployOnlyTarget}
 */
export function deployOnlyTarget(hook) {
  /** @template T @param {T} result */
  const afterChange = (result) => {
    hook.markDirty();
    return Promise.resolve(result);
  };
  return {
    collectionId: DEPLOY_ONLY_COLLECTION_ID,
    requests: 0,
    getCollection: () => Promise.resolve({ displayName: 'deploy hook', fields: [] }),
    listAllItems: () => Promise.resolve([]),
    getItem: () => Promise.resolve(null),
    createItem: (fieldData) =>
      afterChange({ id: `site:${String(fieldData['shopify-id'] || fieldData['slug'])}`, fieldData }),
    updateItem: (id, fieldData) => afterChange({ id, fieldData }),
    deleteItem: () => afterChange(null),
    publish: (ids) => Promise.resolve([{ publishedItemIds: ids, errors: [] }]),
    unpublish: () => afterChange(null),
  };
}

/**
 * The Webflow client, with a build after each Webflow change: Webflow and a static site together.
 *
 * @param {WebflowClient} webflow
 * @param {DeployHook} hook
 * @returns {WebflowClient}
 */
export function withDeployHook(webflow, hook) {
  /**
   * @template {unknown[]} A
   * @template R
   * @param {(...args: A) => Promise<R>} operation
   * @returns {(...args: A) => Promise<R>}
   */
  const marking =
    (operation) =>
    async (...args) => {
      const result = await operation(...args);
      hook.markDirty();
      return result;
    };
  return {
    ...webflow,
    createItem: marking(webflow.createItem),
    updateItem: marking(webflow.updateItem),
    deleteItem: marking(webflow.deleteItem),
    unpublish: marking(webflow.unpublish),
  };
}
