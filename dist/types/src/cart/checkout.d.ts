import type { CheckoutTarget } from '../config.js';
/**
 * The logged-in customer's checkout URL for the cart; `null` when nobody is logged in, so the cart's own checkout URL
 * is used.
 */
type CheckoutResolver = () => Promise<string | null>;
/** Sets the account part's checkout URL, or clears it with `null`. A URL it answers opens checkout logged in. */
export declare function setCheckoutResolver(resolver: CheckoutResolver | null): void;
/**
 * Goes to Shopify's checkout. With `_blank` the tab opens inside the click (Safari blocks `window.open` after an
 * await) and gets its URL once there is one.
 *
 * @returns The checkout URL, `null` with nothing to check out or after a reported failure.
 */
export declare function checkout(target?: CheckoutTarget): Promise<string | null>;
export {};
