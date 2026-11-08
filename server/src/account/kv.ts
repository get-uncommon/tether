/**
 * Where account state lives: the Worker's KV namespace (TETHER_SYNC) under `tether-account:`. Tests and other hosts
 * pass a memory map instead, with the same expiry semantics; the Worker never falls back to one, because a map made
 * per request forgets every session the moment the response is sent.
 */

import type { KvBinding } from '../env.ts';

export interface ExpiringStore {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, ttlSeconds: number) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

export type MemoryEntries = Map<string, { value: string; until: number }>;

const PREFIX = 'tether-account:';
/** Cloudflare KV refuses an expiration shorter than 60 seconds. */
const MIN_KV_TTL_SECONDS = 60;

export function kvAccountStore(namespace: KvBinding): ExpiringStore {
  return {
    async get(key) {
      const value = await namespace.get(PREFIX + key, 'text');
      return typeof value === 'string' ? value : null;
    },
    put: (key, value, ttlSeconds) =>
      namespace.put(PREFIX + key, value, { expirationTtl: Math.max(MIN_KV_TTL_SECONDS, ttlSeconds) }),
    delete: (key) => namespace.delete(PREFIX + key),
  };
}

/**
 * @param entries Owned by the caller, so the state outlives one request.
 */
export function memoryAccountStore(entries: MemoryEntries): ExpiringStore {
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
