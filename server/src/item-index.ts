/**
 * Maps Shopify product ids and slugs to Webflow items. Listing a collection costs one request per 100 items, so the
 * map is cached in the store (`match.indexTtlMinutes`) and listed again only when it is stale or a caller needs the
 * items themselves.
 *
 * A listing checks the run's budget before each page. One that runs out stores the pages it has under
 * `index:listing` and throws {@link IndexListingStopped}; the next listing of a stale index continues from there, so a
 * collection too big for one Worker run is listed over several. While a listing waits, deleting items before its
 * offset shifts the rest, so it can skip an item: a product whose item the index misses gets a slug conflict on its
 * create, and the conflict lists the collection afresh.
 */
import { toSlug } from './mapping.ts';
import { isRecord } from './shared/json.ts';
import { SyncError, scalarText } from './util.ts';

import type { FieldData, MatchSettings } from './mapping.ts';
import type { Product } from './product.ts';
import type { Store } from './store.ts';
import type { CmsTarget, WebflowItem } from './webflow.ts';

/** The run's budget ran out before the listing's last page: what needs the index waits for a later run. */
export class IndexListingStopped extends SyncError {
  constructor(listed: number) {
    super(`listing the Webflow items needs more requests than this run has left (${String(listed)} listed so far)`, {
      code: 'INDEX_LISTING_STOPPED',
    });
    this.name = 'IndexListingStopped';
  }
}

/** The item id and the Shopify id it stores, or `null` for an item made by hand. */
type SlugEntry = [itemId: string, shopifyId: string | null];

interface IndexSnapshot {
  /** When the listing started. */
  at: string;
  /** Shopify id -> item id. */
  byId: Map<string, string>;
  bySlug: Map<string, SlugEntry>;
  /** Present only when this run listed the whole collection. */
  items?: WebflowItem[];
}

/** A listing a run stopped part-way: what it listed, and the offset of its next page. */
type StoredListing = IndexSnapshot & { offset: number };

export interface ItemIndex {
  /**
   * The item of a product: by its Shopify id, or with `match.bySlug` a hand-made item with the product's slug.
   * `fresh` lists the collection again first.
   *
   * @throws {IndexListingStopped} When the index has to be listed and the budget runs out first.
   */
  find: (product: Product, options?: { fresh?: boolean }) => Promise<string | null>;
  /** @throws {IndexListingStopped} As {@link ItemIndex.find}. */
  itemIdFor: (shopifyId: string) => Promise<string | null>;
  /**
   * Every item, listed now.
   *
   * @throws {IndexListingStopped} When the budget runs out first.
   */
  listItems: () => Promise<WebflowItem[]>;
  /** Records a write, once the index is loaded. */
  remember: (itemId: string, fieldData: FieldData) => void;
  /** Records a deleted item, once the index is loaded. */
  forget: (shopifyId: string) => void;
  /** Writes the index to the store if it changed. */
  save: () => Promise<void>;
}

const KEY = 'index';
const LISTING_KEY = 'index:listing';
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

function parseListing(value: unknown): StoredListing | null {
  const snapshot = parseCached(value);
  if (!snapshot || !isRecord(value) || typeof value['offset'] !== 'number') return null;
  return { ...snapshot, offset: value['offset'] };
}

const serialized = ({ at, byId, bySlug }: IndexSnapshot) => ({
  at,
  byId: Object.fromEntries(byId),
  bySlug: Object.fromEntries(bySlug),
});

const shopifyIdOf = (match: MatchSettings, fieldData: FieldData) => {
  const id = fieldData[match.idField];
  const text = id ? scalarText(id) : '';
  return text || null;
};

function add(match: MatchSettings, snapshot: IndexSnapshot, item: WebflowItem): void {
  const shopifyId = shopifyIdOf(match, item.fieldData);
  if (shopifyId && !snapshot.byId.has(shopifyId)) snapshot.byId.set(shopifyId, item.id);
  const slug = item.fieldData['slug'];
  if (typeof slug === 'string' && slug) snapshot.bySlug.set(slug, [item.id, shopifyId]);
}

interface ItemIndexOptions {
  target: CmsTarget;
  store: Store;
  match: MatchSettings;
  now: () => number;
  /** A dry run never writes the index. */
  dryRun: boolean;
  /** Checked before each page. */
  outOfBudget: () => boolean;
  /** The pages this index may list, in all: an index lives for one run. */
  maxPages: number;
}

/**
 * Lists the collection on from a stored listing, or from its first page, within the options' budget and pages.
 *
 * @returns The snapshot, and the items this call listed.
 * @throws {IndexListingStopped} When the budget runs out first, after storing what the listing has.
 */
function createLister({ target, store, match, now, dryRun, outOfBudget, maxPages }: ItemIndexOptions) {
  let pagesListed = 0;
  return async (start: StoredListing | null): Promise<{ snapshot: IndexSnapshot; items: WebflowItem[] }> => {
    const snapshot: IndexSnapshot = start
      ? { at: start.at, byId: start.byId, bySlug: start.bySlug }
      : { at: new Date(now()).toISOString(), byId: new Map(), bySlug: new Map() };
    const items: WebflowItem[] = [];
    let offset: number | null = start ? start.offset : 0;
    let pages = 0;
    while (offset !== null) {
      if (outOfBudget() || pagesListed >= maxPages) {
        if (pages && !dryRun) await store.put(LISTING_KEY, { ...serialized(snapshot), offset });
        throw new IndexListingStopped(snapshot.byId.size);
      }
      const page = await target.listItemPage(offset);
      pagesListed++;
      pages++;
      for (const item of page.items) add(match, snapshot, item);
      items.push(...page.items);
      offset = page.next;
    }
    return { snapshot, items };
  };
}

export function createItemIndex(options: ItemIndexOptions): ItemIndex {
  const { store, match, now, dryRun } = options;
  const listFrom = createLister(options);
  let index: IndexSnapshot | null = null;
  let dirty = false;
  const ttlMs = match.indexTtlMinutes * MS_PER_MINUTE;
  const isCurrent = (snapshot: IndexSnapshot) => now() - Date.parse(snapshot.at) < ttlMs;

  /** Lists every item now, from the first page. */
  async function listed(): Promise<IndexSnapshot & { items: WebflowItem[] }> {
    const { snapshot, items } = await listFrom(null);
    const whole = { ...snapshot, items };
    index = whole;
    dirty = true;
    return whole;
  }

  /** Lists a stale index again, on from the listing a run stopped, unless that one is stale too. */
  async function relisted(): Promise<IndexSnapshot> {
    const stored = parseListing(await store.get(LISTING_KEY));
    const resume = stored && isCurrent(stored) ? stored : null;
    const { snapshot, items } = await listFrom(resume);
    if (stored && !dryRun) await store.delete(LISTING_KEY);
    // A continued listing holds pages listed by earlier runs, so it doesn't count as listed now.
    index = resume ? snapshot : { ...snapshot, items };
    dirty = true;
    return index;
  }

  async function load({ fresh = false }: { fresh?: boolean } = {}): Promise<IndexSnapshot> {
    if (index && (!fresh || index.items)) return index;
    if (fresh) return listed();
    const cached = parseCached(await store.get(KEY));
    if (cached && isCurrent(cached)) {
      index = cached;
      return cached;
    }
    return relisted();
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
      const shopifyId = shopifyIdOf(match, fieldData);
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
      await store.put(KEY, serialized(index));
    },
  };
}
