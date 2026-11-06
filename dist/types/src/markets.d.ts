import type { MarketsConfig } from './config.js';
import type { CountryCode, LanguageCode } from './market-codes.js';
/** A market a visitor chose, as `setCountry()` stores it. */
export interface Market {
    country: CountryCode;
    language: LanguageCode | undefined;
    /** An `Intl` locale for money and dates. */
    locale: string | undefined;
}
export type MarketSource = 'saved' | 'server' | 'webflow';
type MarketField = 'country' | 'language' | 'locale';
type MarketSources = Partial<Record<MarketField, MarketSource>>;
/** The fields detection found, and the source each came from. */
export interface DetectedMarket {
    country?: CountryCode;
    language?: LanguageCode;
    locale?: string;
    /** Absent when `detect: false` turns detection off. */
    sources?: MarketSources;
}
/** What detection reads, passed in so it runs on any document. */
interface MarketEnv {
    document: Pick<Document, 'cookie' | 'querySelector' | 'documentElement'> | null;
    location: Pick<Location, 'pathname'> | null;
    /** `localStorage`, read through `getStored`, which finds nothing where the browser blocks it. */
    storage: Pick<Storage, 'getItem'>;
    /** Where `TETHER_COUNTRY` and `TETHER_LANGUAGE` are read from (`window`). */
    global: object;
}
interface NamedCode {
    isoCode: string;
    name: string;
}
interface Currency {
    isoCode: string;
    symbol: string;
}
export type LocalizedCountry = NamedCode & {
    currency: Currency;
};
/** The store's markets, from the Storefront API's `localization`. */
export interface Localization {
    /** The country of the current `@inContext`. */
    country: LocalizedCountry;
    language: NamedCode;
    availableCountries: (LocalizedCountry & {
        availableLanguages: NamedCode[];
    })[];
}
/** The localStorage key of the visitor's market: `<prefix>:market:<domain>`. */
export declare const storageKey: () => string;
/**
 * A market as `rememberMarket` stores it, validated: storage is written by other tabs, older versions and other
 * scripts too.
 *
 * @param text The value stored under `storageKey()`.
 * @returns `null` when it isn't a valid market.
 */
export declare const parseSavedMarket: (text: string) => Market | null;
/**
 * The visitor's saved market (`setCountry()`, `tether-country-select`).
 *
 * @param storage Default `localStorage`.
 * @returns `null` when nothing valid is saved.
 */
export declare function readSavedMarket(storage?: Pick<Storage, 'getItem'>): Market | null;
/**
 * The market the page's sources point to. Reads the DOM and storage only, so it can run on any `env`.
 *
 * @returns Only the fields found; `{}` with `detect: false`.
 */
export declare function detectMarket(markets?: MarketsConfig | null | undefined, env?: MarketEnv): DetectedMarket;
/** Saves the visitor's choice for the next pages, unless `markets.remember` is false. */
export declare function rememberMarket(market: {
    country: CountryCode;
    language?: string | null | undefined;
    locale?: string | null | undefined;
}): void;
export {};
