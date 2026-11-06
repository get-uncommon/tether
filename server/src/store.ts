/**
 * Where the sync keeps its state: per-product hashes, the item index, the reconcile cursor. Values come back as
 * `unknown`, because KV and the state file can hold anything; the sync parses what it reads.
 */

export interface Store {
  /** `null` when the key is not set. */
  get: (key: string) => Promise<unknown>;
  put: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

/** The part of a Cloudflare KV namespace binding the store uses. */
export interface KvNamespace {
  get: (key: string, type: 'json') => Promise<unknown>;
  put: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
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
  };
}

/** Cloudflare KV. The free plan allows 1,000 writes a day, so the sync only writes when something changed. */
export function kvStore(kv: KvNamespace, prefix = 'tether-sync:'): Store {
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
