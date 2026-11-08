/**
 * Where the sync keeps its state: per-product hashes, the item index, the reconcile cursor. Values come back as
 * `unknown`, because KV and the state file can hold anything; the sync parses what it reads.
 */

export interface Store {
  /** `null` when the key is not set. */
  get: (key: string) => Promise<unknown>;
  /**
   * `expirationTtl` is the seconds after which KV drops the key on its own, 60 at least. The memory and file stores
   * keep the key until it is deleted.
   */
  put: (key: string, value: unknown, options?: KvPutOptions) => Promise<void>;
  delete: (key: string) => Promise<void>;
  /** The first `limit` keys that start with `prefix`, in key order, as KV lists them. At most 1,000. */
  list: (prefix: string, limit: number) => Promise<string[]>;
}

interface KvPutOptions {
  expirationTtl: number;
}

/** The part of a KV `list()` page the store reads. */
export interface KvListPage {
  keys: { name: string }[];
}

/** The part of a Cloudflare KV namespace binding the store uses. */
export interface KvNamespace {
  get: (key: string, type: 'json') => Promise<unknown>;
  put: (key: string, value: string, options?: KvPutOptions) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (options: { prefix: string; limit: number }) => Promise<KvListPage>;
}

/** What KV's `list()` answers with a `limit`, for the stores that hold every key in memory. */
export function firstKeys(keys: Iterable<string>, prefix: string, limit: number): string[] {
  return [...keys]
    .filter((key) => key.startsWith(prefix))
    .sort()
    .slice(0, limit);
}

/** Runs `compute` inside a promise, so a throw becomes a rejection as it would in an async method. */
function settled<T>(compute: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(compute());
  });
}

export function memoryStore(initial: Record<string, unknown> = {}): Store & { map: Map<string, unknown> } {
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
    list: (prefix, limit) => settled(() => firstKeys(map.keys(), prefix, limit)),
  };
}

/**
 * Cloudflare KV. The free plan allows 1,000 writes, 1,000 deletes and 1,000 list requests a day, so the sync only
 * writes when something changed, and every plan allows 1,000 KV operations per Worker invocation. A list may miss a
 * key written in the last minute: KV is eventually consistent.
 */
export function kvStore(kv: KvNamespace, prefix = 'tether-sync:'): Store {
  return {
    get(key) {
      return kv.get(prefix + key, 'json');
    },
    async put(key, value, options) {
      await kv.put(prefix + key, JSON.stringify(value), options);
    },
    async delete(key) {
      await kv.delete(prefix + key);
    },
    async list(keyPrefix, limit) {
      const page = await kv.list({ prefix: prefix + keyPrefix, limit });
      return page.keys.map(({ name }) => name.slice(prefix.length));
    },
  };
}
