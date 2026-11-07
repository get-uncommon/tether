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

/** A product a webhook or an earlier run failed to sync, retried by the next reconcile. */
export interface RetryEntry {
  id: string;
  attempts: number;
  error: string;
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

function parseRetry(value: unknown): RetryEntry | null {
  if (!isRecord(value)) return null;
  const { id, attempts, error } = value;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return { id: String(id), attempts: typeof attempts === 'number' ? attempts || 1 : 1, error: scalarText(error) };
}

export async function readRetries(store: Store): Promise<RetryEntry[]> {
  const value = await store.get(RETRY_KEY);
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => parseRetry(entry) ?? []);
}

/** A failure waiting under its own key for the next reconcile. */
export interface QueuedRetry {
  key: string;
  entry: RetryEntry;
}

/** @param id A numeric product id. */
export const retryInboxKey = (id: string): string => `${RETRY_INBOX_PREFIX}${id}:${crypto.randomUUID()}`;

/**
 * The failures queued under their own keys. A key listed whose value is gone, deleted by a run whose delete the list
 * doesn't show yet, is left out.
 */
export async function readRetryInbox(store: Store): Promise<QueuedRetry[]> {
  const queued: QueuedRetry[] = [];
  for (const key of await store.list(RETRY_INBOX_PREFIX)) {
    const entry = parseRetry(await store.get(key));
    if (entry) queued.push({ key, entry });
  }
  return queued;
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
