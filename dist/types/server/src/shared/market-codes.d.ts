/**
 * Country and language codes as Shopify takes them, parsed the same way in the browser and the Worker: anything that
 * isn't a code is dropped rather than repaired.
 */
/** An ISO 3166-1 alpha-2 code, upper case. */
export type CountryCode = string & {
    readonly __brand: 'CountryCode';
};
/** A Shopify `LanguageCode` value. */
export type LanguageCode = string & {
    readonly __brand: 'LanguageCode';
};
/** @returns `'de'` → `'DE'`; `null` for anything that is not a country code. */
export declare function toCountry(value: unknown): CountryCode | null;
/** @returns `'de-DE'` → `'DE'`, `'pt-BR'` → `'PT_BR'`, `'en'` → `'EN'`; `null` otherwise. */
export declare function toLanguage(value: unknown): LanguageCode | null;
