/**
 * The sync engine's records in the store, and their parsers. The store hands back whatever it holds, so each record
 * is checked once here and the engine works with typed values. The keys and shapes are what deployed Workers already
 * have in KV.
 */
import type { Store } from './store.ts';
import { isRecord } from './shared/json.ts';
import { numericId, scalarText } from './util.ts';

/** What the last write for a product was. `hash` is `null` until the item is live, so a failed publish is retried. */
export interface ProductState {
  itemId: string;
  hash: string | null;
  handle?: string;
  at: string;
  removed?: true;
}

/** A product a webhook or an earlier run failed to sync, retried by the reconcile. */
export interface RetryEntry {
  id: string;
  attempts: number;
  error: string;
  /** When the product's first failure was, in ms since the epoch: the sync gives up on it a day after. */
  failingSince: number;
  /** When the next attempt is due, in ms since the epoch. */
  retryAt: number;
}

/**
 * A reconcile window stopped part-way: where it starts, the cursor of the last product done (`null` before the first),
 * and the newest `updatedAt` seen so far.
 */
export interface ReconcilePage {
  since: string;
  after: string | null;
  newest: string;
}

/** The `updatedAt` the next reconcile window starts at. */
export const SINCE_KEY = 'reconcile:since';
export const PAGE_KEY = 'reconcile:page';
/**
 * The retry list, which only reconcile runs write: each run reads it at its start and writes it whole at its end, so an
 * entry another writer added in between would be lost. A webhook's failure goes under a key of its own instead, beneath
 * {@link RETRY_INBOX_PREFIX}, and the next reconcile moves it into the list.
 */
export const RETRY_KEY = 'reconcile:retry';
/** One key per failure, unique to it, so no writer ever overwrites or deletes an entry it hasn't read. */
const RETRY_INBOX_PREFIX = 'reconcile:retry:';

/** @param id A product gid or numeric id. */
export const productKey = (id: string | number): string => `p:${numericId(id)}`;

/** @param key From {@link productKey}. */
export async function readProductState(store: Store, key: string): Promise<ProductState | null> {
  const value = await store.get(key);
  if (!isRecord(value) || typeof value['itemId'] !== 'string') return null;
  const state: ProductState = {
    itemId: value['itemId'],
    hash: typeof value['hash'] === 'string' ? value['hash'] : null,
    at: typeof value['at'] === 'string' ? value['at'] : '',
  };
  if (typeof value['handle'] === 'string') state.handle = value['handle'];
  if (value['removed']) state.removed = true;
  return state;
}

const timeOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * An entry without `failingSince` or `retryAt`, as releases before them store it, fails from `now` on and is due now.
 *
 * @param now The time of the read, in ms since the epoch.
 */
function parseRetry(value: unknown, now: number): RetryEntry | null {
  if (!isRecord(value)) return null;
  const { id, attempts, error, failingSince, retryAt } = value;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return {
    id: String(id),
    attempts: typeof attempts === 'number' ? attempts || 1 : 1,
    error: scalarText(error),
    failingSince: timeOr(failingSince, now),
    retryAt: timeOr(retryAt, now),
  };
}

/** The retry list: its entries, and the value KV holds, to tell whether a run changed it. */
export interface RetryList {
  entries: RetryEntry[];
  stored: unknown;
}

/** @param now The time of the read, in ms since the epoch. */
export async function readRetries(store: Store, now: number): Promise<RetryList> {
  const stored = await store.get(RETRY_KEY);
  const entries = Array.isArray(stored) ? stored.flatMap((entry: unknown) => parseRetry(entry, now) ?? []) : [];
  return { entries, stored };
}

/** @param id A numeric product id. */
export const retryInboxKey = (id: string): string => `${RETRY_INBOX_PREFIX}${id}:${crypto.randomUUID()}`;

/**
 * The inbox keys one reconcile takes in, so a run's KV operations stay bounded however many failures wait: Cloudflare
 * allows 1,000 per Worker invocation. A bigger inbox drains over the next runs.
 */
const RETRY_INBOX_PAGE = 100;
/** A run's KV operations on the inbox: the list, at most a read per key, and a delete per key. */
export const RETRY_INBOX_KV_OPERATIONS = 1 + 2 * RETRY_INBOX_PAGE;
/** KV drops a queued failure no reconcile took in after 30 days, so a release that never lists the inbox leaves none. */
export const RETRY_INBOX_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The failures one reconcile takes from the inbox. */
export interface RetryInbox {
  /** Every key taken in, its product's duplicates included: each is deleted once the retry list is stored. */
  keys: string[];
  /** One entry per product. */
  entries: RetryEntry[];
}

/** The product id a key from {@link retryInboxKey} names. */
function inboxKeyProduct(key: string): string {
  const rest = key.slice(RETRY_INBOX_PREFIX.length);
  const end = rest.indexOf(':');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The first {@link RETRY_INBOX_PAGE} queued failures. A product's keys are read until one holds its failure. A key
 * listed whose value is gone, deleted by a run whose delete the list doesn't show yet, is left out.
 *
 * @param now The time of the read, in ms since the epoch.
 */
export async function readRetryInbox(store: Store, now: number): Promise<RetryInbox> {
  const keys = await store.list(RETRY_INBOX_PREFIX, RETRY_INBOX_PAGE);
  const entries = new Map<string, RetryEntry>();
  for (const key of keys) {
    const product = inboxKeyProduct(key);
    if (entries.has(product)) continue;
    const entry = parseRetry(await store.get(key), now);
    if (entry) entries.set(product, entry);
  }
  return { keys, entries: [...entries.values()] };
}

/**
 * A record may also hold `offset`: the products done of the page listed after `after`. It is ignored, so that page is
 * synced again from its start; products already in sync cost no write.
 */
export async function readPage(store: Store): Promise<ReconcilePage | null> {
  const value = await store.get(PAGE_KEY);
  if (!isRecord(value) || typeof value['since'] !== 'string') return null;
  const { since, after, newest } = value;
  return {
    since,
    after: typeof after === 'string' ? after : null,
    newest: typeof newest === 'string' ? newest : since,
  };
}

export async function readSince(store: Store): Promise<string | null> {
  const value = await store.get(SINCE_KEY);
  return typeof value === 'string' && value ? value : null;
}
