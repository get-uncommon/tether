/**
 * Maps Shopify product ids and slugs to Webflow items. Listing a collection costs one request per 100 items, so the
 * map is cached in the store (`match.indexTtlMinutes`) and listed again only when it is stale or a caller needs the
 * items themselves.
 */
import { toSlug } from './mapping.ts';
import { isRecord } from './shared/json.ts';
import { scalarText } from './util.ts';

import type { FieldData, MatchSettings } from './mapping.ts';
import type { Product } from './product.ts';
import type { Store } from './store.ts';
import type { CmsTarget, WebflowItem } from './webflow.ts';

/** The item id and the Shopify id it stores, or `null` for an item made by hand. */
type SlugEntry = [itemId: string, shopifyId: string | null];

interface IndexSnapshot {
  /** When the items were listed. */
  at: string;
  /** Shopify id -> item id. */
  byId: Map<string, string>;
  bySlug: Map<string, SlugEntry>;
  /** Present only when this run listed the collection. */
  items?: WebflowItem[];
}

export interface ItemIndex {
  /**
   * The item of a product: by its Shopify id, or with `match.bySlug` a hand-made item with the product's slug.
   * `fresh` lists the collection again first.
   */
  find: (product: Product, options?: { fresh?: boolean }) => Promise<string | null>;
  itemIdFor: (shopifyId: string) => Promise<string | null>;
  /** Every item, listed now. */
  listItems: () => Promise<WebflowItem[]>;
  /** Records a write, once the index is loaded. */
  remember: (itemId: string, fieldData: FieldData) => void;
  /** Records a deleted item, once the index is loaded. */
  forget: (shopifyId: string) => void;
  /** Writes the index to the store if it changed. */
  save: () => Promise<void>;
}

const KEY = 'index';
const MS_PER_MINUTE = 60000;

function parseById(value: unknown): Map<string, string> {
  if (!isRecord(value)) return new Map();
  return new Map(
    Object.entries(value).flatMap(([shopifyId, itemId]): [string, string][] =>
      typeof itemId === 'string' ? [[shopifyId, itemId]] : [],
    ),
  );
}

function parseBySlug(value: unknown): Map<string, SlugEntry> {
  if (!isRecord(value)) return new Map();
  const bySlug = new Map<string, SlugEntry>();
  for (const [slug, entry] of Object.entries(value)) {
    if (!Array.isArray(entry)) continue;
    const pair: unknown[] = entry;
    const [itemId, shopifyId] = pair;
    if (typeof itemId !== 'string') continue;
    bySlug.set(slug, [itemId, typeof shopifyId === 'string' ? shopifyId : null]);
  }
  return bySlug;
}

/** The cached index, or `null` when there is none. */
function parseCached(value: unknown): IndexSnapshot | null {
  if (!isRecord(value) || typeof value['at'] !== 'string') return null;
  return { at: value['at'], byId: parseById(value['byId']), bySlug: parseBySlug(value['bySlug']) };
}

interface ItemIndexOptions {
  target: CmsTarget;
  store: Store;
  match: MatchSettings;
  now: () => number;
  /** A dry run never writes the index. */
  dryRun: boolean;
}

export function createItemIndex({ target, store, match, now, dryRun }: ItemIndexOptions): ItemIndex {
  let index: IndexSnapshot | null = null;
  let dirty = false;

  const shopifyIdOf = (fieldData: FieldData) => {
    const id = fieldData[match.idField];
    const text = id ? scalarText(id) : '';
    return text || null;
  };

  async function listed(): Promise<IndexSnapshot & { items: WebflowItem[] }> {
    const items = await target.listAllItems();
    const snapshot = {
      items,
      byId: new Map<string, string>(),
      bySlug: new Map<string, SlugEntry>(),
      at: new Date(now()).toISOString(),
    };
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

  async function load({ fresh = false }: { fresh?: boolean } = {}): Promise<IndexSnapshot> {
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
