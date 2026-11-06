/**
 * The sync engine's records in the store, and their parsers. The store hands back whatever it holds, so each record
 * is checked once here and the engine works with typed values. The keys and shapes are what deployed Workers already
 * have in KV.
 */
import { isRecord, numericId, scalarText } from './util.js';

/** @typedef {import('./store.js').Store} Store */

/**
 * What the last write for a product was. `hash` is `null` until the item is live, so a failed publish is retried.
 *
 * @typedef {{ itemId: string, hash: string | null, handle?: string, at: string, removed?: true }} ProductState
 */

/**
 * A product a webhook or an earlier run failed to sync, retried by the next reconcile.
 *
 * @typedef {{ id: string, attempts: number, error: string }} RetryEntry
 */

/**
 * A reconcile window stopped part-way: the page cursor, how many products of that page are done, and the newest
 * `updatedAt` seen so far.
 *
 * @typedef {{ since: string, after: string | null, offset: number, newest: string }} ReconcilePage
 */

/** The `updatedAt` the next reconcile window starts at. */
export const SINCE_KEY = 'reconcile:since';
export const PAGE_KEY = 'reconcile:page';
export const RETRY_KEY = 'reconcile:retry';

/** @param {string | number} id A product gid or numeric id. */
export const productKey = (id) => `p:${numericId(id)}`;

/**
 * @param {Store} store
 * @param {string} key From {@link productKey}.
 * @returns {Promise<ProductState | null>}
 */
export async function readProductState(store, key) {
  const value = await store.get(key);
  if (!isRecord(value) || typeof value['itemId'] !== 'string') return null;
  /** @type {ProductState} */
  const state = {
    itemId: value['itemId'],
    hash: typeof value['hash'] === 'string' ? value['hash'] : null,
    at: typeof value['at'] === 'string' ? value['at'] : '',
  };
  if (typeof value['handle'] === 'string') state.handle = value['handle'];
  if (value['removed']) state.removed = true;
  return state;
}

/** @param {unknown} value @returns {RetryEntry[]} */
function parseRetries(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const { id, attempts, error } = entry;
    if (typeof id !== 'string' && typeof id !== 'number') return [];
    return [{ id: String(id), attempts: typeof attempts === 'number' ? attempts || 1 : 1, error: scalarText(error) }];
  });
}

/** @param {Store} store */
export async function readRetries(store) {
  return parseRetries(await store.get(RETRY_KEY));
}

/**
 * @param {Store} store
 * @returns {Promise<ReconcilePage | null>}
 */
export async function readPage(store) {
  const value = await store.get(PAGE_KEY);
  if (!isRecord(value) || typeof value['since'] !== 'string') return null;
  const { since, after, offset, newest } = value;
  return {
    since,
    after: typeof after === 'string' ? after : null,
    offset: typeof offset === 'number' ? offset : 0,
    newest: typeof newest === 'string' ? newest : since,
  };
}

/**
 * @param {Store} store
 * @returns {Promise<string | null>}
 */
export async function readSince(store) {
  const value = await store.get(SINCE_KEY);
  return typeof value === 'string' && value ? value : null;
}
