/**
 * Where account state lives: the Worker's KV namespace (TETHER_SYNC) under `tether-account:`, or a memory map with the
 * same expiry semantics when there is no namespace (Node, tests).
 */

/**
 * @typedef {object} ExpiringStore
 * @property {(key: string) => Promise<string | null>} get
 * @property {(key: string, value: string, ttlSeconds: number) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 */

/**
 * The parts of a Cloudflare KV namespace the account code uses.
 *
 * @typedef {object} KvNamespace
 * @property {(key: string) => Promise<string | null>} get
 * @property {(key: string, value: string, options: { expirationTtl: number }) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 */

/** @typedef {Map<string, { value: string, until: number }>} MemoryEntries */

const PREFIX = 'tether-account:';
/** Cloudflare KV refuses an expiration shorter than 60 seconds. */
const MIN_KV_TTL_SECONDS = 60;

/** @param {KvNamespace} namespace @returns {ExpiringStore} */
function kvStore(namespace) {
  return {
    get: (key) => namespace.get(PREFIX + key),
    put: (key, value, ttlSeconds) =>
      namespace.put(PREFIX + key, value, { expirationTtl: Math.max(MIN_KV_TTL_SECONDS, ttlSeconds) }),
    delete: (key) => namespace.delete(PREFIX + key),
  };
}

/** @param {MemoryEntries} entries @returns {ExpiringStore} */
function memoryStore(entries) {
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return Promise.resolve(null);
      if (entry.until < Date.now()) {
        entries.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(entry.value);
    },
    put(key, value, ttlSeconds) {
      entries.set(key, { value, until: Date.now() + ttlSeconds * 1000 });
      return Promise.resolve();
    },
    delete(key) {
      entries.delete(key);
      return Promise.resolve();
    },
  };
}

/**
 * @param {KvNamespace | undefined} namespace The TETHER_SYNC binding, when there is one.
 * @param {MemoryEntries} [memory] The map to use without a namespace; a fresh one by default.
 * @returns {ExpiringStore}
 */
export function accountStore(namespace, memory = new Map()) {
  return namespace ? kvStore(namespace) : memoryStore(memory);
}
