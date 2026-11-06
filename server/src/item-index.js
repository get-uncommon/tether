/**
 * Maps Shopify product ids and slugs to Webflow items. Listing a collection costs one request per 100 items, so the
 * map is cached in the store (`match.indexTtlMinutes`) and listed again only when it is stale or a caller needs the
 * items themselves.
 */
import { toSlug } from './mapping.js';
import { isRecord, scalarText } from './util.js';

/** @typedef {import('./mapping.js').FieldData} FieldData */
/** @typedef {import('./mapping.js').Product} Product */
/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./webflow.js').CmsTarget} CmsTarget */
/** @typedef {import('./webflow.js').WebflowItem} WebflowItem */

/**
 * The item id and the Shopify id it stores, or `null` for an item made by hand.
 *
 * @typedef {[itemId: string, shopifyId: string | null]} SlugEntry
 */

/**
 * @typedef {object} IndexSnapshot
 * @property {string} at When the items were listed.
 * @property {Map<string, string>} byId Shopify id -> item id.
 * @property {Map<string, SlugEntry>} bySlug
 * @property {WebflowItem[]} [items] Present only when this run listed the collection.
 */

/**
 * @typedef {object} ItemIndex
 * @property {(product: Product, options?: { fresh?: boolean }) => Promise<string | null>} find The item of a product:
 *   by its Shopify id, or with `match.bySlug` a hand-made item with the product's slug. `fresh` lists the collection
 *   again first.
 * @property {(shopifyId: string) => Promise<string | null>} itemIdFor
 * @property {() => Promise<WebflowItem[]>} listItems Every item, listed now.
 * @property {(itemId: string, fieldData: FieldData) => void} remember Records a write, once the index is loaded.
 * @property {(shopifyId: string) => void} forget Records a deleted item, once the index is loaded.
 * @property {() => Promise<void>} save Writes the index to the store if it changed.
 */

const KEY = 'index';
const MS_PER_MINUTE = 60000;

/**
 * @param {unknown} value
 * @returns {Map<string, string>}
 */
function parseById(value) {
  if (!isRecord(value)) return new Map();
  return new Map(
    Object.entries(value).flatMap(([shopifyId, itemId]) => (typeof itemId === 'string' ? [[shopifyId, itemId]] : [])),
  );
}

/**
 * @param {unknown} value
 * @returns {Map<string, SlugEntry>}
 */
function parseBySlug(value) {
  if (!isRecord(value)) return new Map();
  /** @type {Map<string, SlugEntry>} */
  const bySlug = new Map();
  for (const [slug, entry] of Object.entries(value)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    bySlug.set(slug, [entry[0], typeof entry[1] === 'string' ? entry[1] : null]);
  }
  return bySlug;
}

/**
 * The cached index, or `null` when there is none.
 *
 * @param {unknown} value
 * @returns {IndexSnapshot | null}
 */
function parseCached(value) {
  if (!isRecord(value) || typeof value['at'] !== 'string') return null;
  return { at: value['at'], byId: parseById(value['byId']), bySlug: parseBySlug(value['bySlug']) };
}

/**
 * @param {object} options
 * @param {CmsTarget} options.target
 * @param {Store} options.store
 * @param {import('./mapping.js').MatchSettings} options.match
 * @param {() => number} options.now
 * @param {boolean} options.dryRun A dry run never writes the index.
 * @returns {ItemIndex}
 */
export function createItemIndex({ target, store, match, now, dryRun }) {
  /** @type {IndexSnapshot | null} */
  let index = null;
  let dirty = false;

  /** @param {FieldData} fieldData */
  const shopifyIdOf = (fieldData) => {
    const id = fieldData[match.idField];
    const text = id ? scalarText(id) : '';
    return text || null;
  };

  /** @returns {Promise<IndexSnapshot & { items: WebflowItem[] }>} */
  async function listed() {
    const items = await target.listAllItems();
    const snapshot = { items, byId: new Map(), bySlug: new Map(), at: new Date(now()).toISOString() };
    for (const item of items) {
      const shopifyId = shopifyIdOf(item.fieldData);
      if (shopifyId && !snapshot.byId.has(shopifyId)) snapshot.byId.set(shopifyId, item.id);
      const slug = item.fieldData['slug'];
      if (typeof slug === 'string' && slug) snapshot.bySlug.set(slug, [item.id, shopifyId]);
    }
    index = snapshot;
    dirty = true;
    return snapshot;
  }

  /** @param {{ fresh?: boolean }} [options] @returns {Promise<IndexSnapshot>} */
  async function load({ fresh = false } = {}) {
    if (index && (!fresh || index.items)) return index;
    if (!fresh && !index) {
      const cached = parseCached(await store.get(KEY));
      if (cached && now() - Date.parse(cached.at) < match.indexTtlMinutes * MS_PER_MINUTE) {
        index = cached;
        return cached;
      }
    }
    return listed();
  }

  return {
    async find(product, options) {
      const snapshot = await load(options);
      const byId = snapshot.byId.get(product.legacyId);
      if (byId) return byId;
      if (!match.bySlug) return null;
      // Adopt a hand-made CMS item with the same slug, unless it belongs to another product.
      const hit = snapshot.bySlug.get(toSlug(product.handle));
      return hit && !hit[1] ? hit[0] : null;
    },

    async itemIdFor(shopifyId) {
      return (await load()).byId.get(shopifyId) ?? null;
    },

    async listItems() {
      if (index?.items) return index.items;
      return (await listed()).items;
    },

    remember(itemId, fieldData) {
      if (!index) return;
      const shopifyId = shopifyIdOf(fieldData);
      if (shopifyId) index.byId.set(shopifyId, itemId);
      const slug = fieldData['slug'];
      if (typeof slug === 'string' && slug) index.bySlug.set(slug, [itemId, shopifyId]);
      dirty = true;
    },

    forget(shopifyId) {
      if (!index) return;
      index.byId.delete(shopifyId);
      dirty = true;
    },

    async save() {
      if (!dirty || dryRun || !index) return;
      dirty = false;
      await store.put(KEY, {
        at: index.at,
        byId: Object.fromEntries(index.byId),
        bySlug: Object.fromEntries(index.bySlug),
      });
    },
  };
}
