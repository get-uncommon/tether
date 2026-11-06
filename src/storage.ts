/**
 * The browser's `localStorage` and `sessionStorage`, which may be blocked: accessing them throws in private mode, in
 * sandboxed frames and where the visitor blocks site data, and writing throws when they are full. Tether then keeps
 * nothing between pages: a read finds nothing, and a write or removal does nothing. Each call catches on its own, so a
 * blocked area never stops a call on the other.
 */

type StorageArea = 'localStorage' | 'sessionStorage';

/** @returns `null` when nothing is stored under `key`, or the storage is blocked. */
export function getStored(key: string, area: StorageArea = 'localStorage'): string | null {
  try {
    return window[area].getItem(key);
  } catch {
    // Blocked storage holds nothing: see the file's comment.
    return null;
  }
}

export function setStored(key: string, value: string, area: StorageArea = 'localStorage'): void {
  try {
    window[area].setItem(key, value);
  } catch {
    // Blocked or full storage keeps nothing: see the file's comment.
  }
}

export function removeStored(key: string, area: StorageArea = 'localStorage'): void {
  try {
    window[area].removeItem(key);
  } catch {
    // Blocked storage has nothing to remove: see the file's comment.
  }
}
