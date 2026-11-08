interface ProductKeySource {
    /** The product to load; `null` when the attribute or the page URL has none. */
    key: string | null;
    /** The key comes from the page URL (`url:…`). */
    fromUrl: boolean;
    /** The attribute's value as written. */
    raw: string;
}
type ScopeStatus = 'loading' | 'ready' | 'error' | 'not-found';
/**
 * Reads a `tether-product` value:
 * - `coffee-box`: a handle, numeric id, gid or product URL;
 * - `url:handle`: `?handle=` from the page URL (any parameter: `url:p` reads `?p=`);
 * - `url:path`: the last segment of the page path (`/shop/coffee-box` → `coffee-box`).
 *
 * @param name The attribute, without prefix.
 */
export declare function resolveProductKey(el: Element, location?: Pick<Location, 'pathname' | 'search'>, name?: string): ProductKeySource;
/** The values of `tether-show` that follow the scope's state. */
export declare const STATUS_KEYS: readonly ScopeStatus[];
/** @returns True for a `TetherError` with code `NOT_FOUND`. */
export declare const isNotFound: (error: unknown) => boolean;
/** @returns The selector of every scope that owns its state elements; the nearest one wins. */
export declare const boundary: () => string;
/** @returns True when `el` belongs to the scope `root`, not to a scope nested in it. */
export declare const ownedBy: (el: Element, root: Element) => boolean;
/**
 * Sets `tether-state` (loading | ready | error) and `tether-error` (not-found or an error code) on `root`, toggles
 * `tether-show="loading|ready|error|not-found"` inside it, and disables its add-to-cart buttons when there's no
 * product.
 */
export declare function setScopeStatus(root: Element, status: ScopeStatus, error?: unknown): void;
export {};
