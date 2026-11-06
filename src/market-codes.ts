/**
 * Country and language codes as Shopify's `@inContext` takes them. Every market value that reaches a query passes
 * through here: they are written into the query text, so anything else is dropped rather than sent.
 */

/** An ISO 3166-1 alpha-2 code, upper case. */
export type CountryCode = string & { readonly __brand: 'CountryCode' };
/** A Shopify `LanguageCode` value. */
export type LanguageCode = string & { readonly __brand: 'LanguageCode' };

const COUNTRY = /^[A-Z]{2}$/;
/** Cloudflare's codes for an unknown country (XX) and Tor (T1), which a `cf-ipcountry` cookie can carry. */
const NOT_A_COUNTRY = new Set(['XX', 'T1']);
/** Shopify `LanguageCode` values with a region. Every other language is its plain ISO 639 code. */
const REGIONAL_LANGUAGES = new Set(['PT_BR', 'PT_PT', 'ZH_CN', 'ZH_TW']);
const LANGUAGE = /^[A-Z]{2,3}$/;

/** @returns `'de'` → `'DE'`; `null` for anything that is not a country code. */
export function toCountry(value: unknown): CountryCode | null {
  const code = (typeof value === 'string' ? value : '').trim().toUpperCase();
  if (!COUNTRY.test(code) || NOT_A_COUNTRY.has(code)) return null;
  // The checks above are what makes a string a CountryCode.
  return code as CountryCode;
}

/** @returns `'de-DE'` → `'DE'`, `'pt-BR'` → `'PT_BR'`, `'en'` → `'EN'`; `null` otherwise. */
export function toLanguage(value: unknown): LanguageCode | null {
  const raw = (typeof value === 'string' ? value : '').trim().replace('-', '_').toUpperCase();
  // The set and the pattern are what makes a string a LanguageCode.
  if (REGIONAL_LANGUAGES.has(raw)) return raw as LanguageCode;
  const primary = raw.split('_')[0] ?? '';
  return LANGUAGE.test(primary) ? (primary as LanguageCode) : null;
}
