/** A mounted `ListScope`. */
interface MountedList {
    root: Element;
    load: (more?: boolean) => Promise<unknown>;
}
export declare const mountedProducts: WeakSet<Element>;
export declare const mountedLists: WeakSet<Element>;
/** Product roots to re-render after a country switch; pruned once disconnected. */
export declare const liveProducts: Set<HTMLElement>;
/** Lists to reload after a country switch; pruned once disconnected. */
export declare const liveLists: Set<MountedList>;
/** Forgets roots a page transition removed, so they aren't kept alive. */
export declare function pruneLive(): void;
/** @returns `root` itself when it matches, then the matches inside it. */
export declare function within(root: ParentNode & Partial<Pick<Element, 'matches'>>, selector: string): HTMLElement[];
/**
 * Mounts one product root.
 *
 * @returns True when a product request was started.
 */
export declare function mountProduct(el: HTMLElement): boolean;
/** Loads again the product scopes that failed on a network or API error, for when the browser is back online. */
export declare function retryFailed(): void;
/**
 * Lists, and anything else that loads prices, hold `html.tether-market-pending` until they are in.
 *
 * @returns `loading` itself.
 */
export declare const trackMarket: <T>(loading: Promise<T>) => Promise<T>;
/** After a mount: drops `html.tether-market-pending` once this page's products are live. */
export declare function settleMarket(): void;
/**
 * Uses the products in the page's hydrate tags (`tether/server` `hydrate()`) without a request. A tag made for another
 * market is skipped, and marks the page (`html.tether-market-pending`) until the live prices are in, so CSS can hide
 * prices meanwhile.
 *
 * Trust: a hydrate tag is part of the page, written by the site's own build like the rest of its HTML and scripts, so
 * its prices and products are shown until the background refresh replaces them. Whoever can write a tag into the page
 * can already write a script there; the shape check (`isProductShape`) is for a truncated or hand-written tag, which
 * is skipped instead of failing a render.
 *
 * @param root Where to look: the document for a mount (a tag may sit in `<head>` or anywhere else on the page), the
 *   added elements for `observe`.
 */
export declare function hydrateFromPage(root?: Document | Element): void;
export {};
