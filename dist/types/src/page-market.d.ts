import type { TetherOptions } from './config.js';
import type { Parts } from './lazy.js';
import type { ShopifyCart } from './cart/store.js';
export type SetCountryOptions = Parameters<Parts['markets']['setCountry']>[1];
/**
 * Sets `cfg`'s market for the first page, over the configured one.
 *
 * @param overrides What `init()` was called with: a `locale` there wins over the visitor's.
 */
export declare function applyStartMarket(overrides: TetherOptions): Promise<void>;
/**
 * The market to switch to on arriving at the current page. A page built for a market switches to it; the first page
 * without one after such a page switches back to the visitor's own choice, else to the configured market.
 *
 * @returns `null` when the page stays in the market in use.
 */
export declare function marketForArrival(): {
    country: string;
    language: string | undefined;
    locale: string | undefined;
} | null;
/**
 * `Tether.setCountry('DE')`: loads the markets part on first use.
 *
 * @returns The cart once everything is in the new market.
 */
export declare function setCountry(code: string, options?: SetCountryOptions): Promise<ShopifyCart | null>;
