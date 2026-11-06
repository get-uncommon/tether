/**
 * Where the sync keeps its state: per-product hashes, the item index, the reconcile cursor. Values come back as
 * `unknown`, because KV and the state file can hold anything; the sync parses what it reads.
 */

/**
 * @typedef {object} Store
 * @property {(key: string) => Promise<unknown>} get `null` when the key is not set.
 * @property {(key: string, value: unknown) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 */

/**
 * The part of a Cloudflare KV namespace binding the store uses.
 *
 * @typedef {object} KvNamespace
 * @property {(key: string, type: 'json') => Promise<unknown>} get
 * @property {(key: string, value: string) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 */

/**
 * Runs `compute` inside a promise, so a throw becomes a rejection as it would in an async method.
 *
 * @template T
 * @param {() => T} compute
 * @returns {Promise<T>}
 */
function settled(compute) {
  return new Promise((resolve) => {
    resolve(compute());
  });
}

/**
 * @param {Record<string, unknown>} [initial]
 * @returns {Store & { map: Map<string, unknown> }}
 */
export function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get: (key) => settled(() => (map.has(key) ? structuredClone(map.get(key)) : null)),
    put: (key, value) =>
      settled(() => {
        map.set(key, structuredClone(value));
      }),
    delete: (key) =>
      settled(() => {
        map.delete(key);
      }),
  };
}

/**
 * Cloudflare KV. The free plan allows 1,000 writes a day, so the sync only writes when something changed.
 *
 * @param {KvNamespace} kv
 * @param {string} [prefix]
 * @returns {Store}
 */
export function kvStore(kv, prefix = 'tether-sync:') {
  return {
    get(key) {
      return kv.get(prefix + key, 'json');
    },
    async put(key, value) {
      await kv.put(prefix + key, JSON.stringify(value));
    },
    async delete(key) {
      await kv.delete(prefix + key);
    },
  };
}
