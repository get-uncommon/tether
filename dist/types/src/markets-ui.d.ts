import { Cart } from './cart.js';
import type { Localization } from './markets.js';
export { detectMarket } from './markets.js';
/**
 * The countries the store sells to (Shopify Markets), with their currency. Cached per page; a failed request is not
 * cached, so the next call tries again.
 */
export declare function getLocalization(): Promise<Localization>;
interface SetCountryOptions {
    /** A Shopify language; `null` clears it. Default: the `markets.locales` entry for the country, else unchanged. */
    language?: string | null | undefined;
    /** The money format. Default: the `markets.locales` entry, else unchanged. */
    locale?: string | undefined;
    /** Save the choice for the next pages (default true). */
    remember?: boolean | undefined;
}
/**
 * Fills `select[tether-country-select]` with the countries the store sells to (Shopify Markets), and
 * `tether-country-bind="name|code|currency|symbol"` with the current country. `tether-country-label` sets the option
 * text from `{name}`, `{code}`, `{currency}` and `{symbol}`. A failure is reported, never thrown.
 */
export declare function renderCountrySelects(root?: ParentNode): Promise<void>;
/**
 * Switches the market: prices, currency and translations follow (`@inContext`), the cart's
 * `buyerIdentity.countryCode` is updated, and every product and list on the page re-renders.
 *
 *   Tether.setCountry('DE')            Tether.setCountry('BE', { language: 'FR' })
 *
 * @returns The cart once everything is in the new market.
 * @throws {TetherError} `INVALID_COUNTRY` for anything that isn't a country code.
 */
export declare function setCountry(code: string, { language, locale, remember }?: SetCountryOptions): Promise<typeof Cart.state>;
