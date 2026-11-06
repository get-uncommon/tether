// @ts-nocheck
/**
 * Sync state: product id -> { itemId, hash }, plus the reconcile cursor.
 * Any object with async get/put/delete works.
 */

export function memoryStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    map: m,
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : null; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { m.delete(k); },
  };
}

/** Cloudflare KV. Free plan: 1,000 writes/day, so the sync only writes when something changed. */
export function kvStore(kv, prefix = 'tether-sync:') {
  return {
    async get(k) { return kv.get(prefix + k, 'json'); },
    async put(k, v) { await kv.put(prefix + k, JSON.stringify(v)); },
    async delete(k) { await kv.delete(prefix + k); },
  };
}
