/**
 * The browser's `localStorage` and `sessionStorage`, which may be blocked: accessing them throws in private mode, in
 * sandboxed frames and where the visitor blocks site data, and writing throws when they are full. Tether then keeps
 * nothing between pages: a read finds nothing, and a write or removal does nothing. Each call catches on its own, so a
 * blocked area never stops a call on the other.
 */
type StorageArea = 'localStorage' | 'sessionStorage';
/** @returns `null` when nothing is stored under `key`, or the storage is blocked. */
export declare function getStored(key: string, area?: StorageArea): string | null;
export declare function setStored(key: string, value: string, area?: StorageArea): void;
export declare function removeStored(key: string, area?: StorageArea): void;
export {};
