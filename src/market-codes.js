/**
 * Country and language codes as Shopify's `@inContext` takes them. Every market value that reaches a query passes
 * through here: they are written into the query text, so anything else is dropped rather than sent.
 */

/** @typedef {string & { readonly __brand: 'CountryCode' }} CountryCode An ISO 3166-1 alpha-2 code, upper case. */
/** @typedef {string & { readonly __brand: 'LanguageCode' }} LanguageCode A Shopify `LanguageCode` value. */

const COUNTRY = /^[A-Z]{2}$/;
/** Cloudflare's codes for an unknown country (XX) and Tor (T1), which a `cf-ipcountry` cookie can carry. */
const NOT_A_COUNTRY = new Set(['XX', 'T1']);
/** Shopify `LanguageCode` values with a region. Every other language is its plain ISO 639 code. */
const REGIONAL_LANGUAGES = new Set(['PT_BR', 'PT_PT', 'ZH_CN', 'ZH_TW']);
const LANGUAGE = /^[A-Z]{2,3}$/;

/**
 * @param {unknown} value
 * @returns {CountryCode | null} `'de'` → `'DE'`; `null` for anything that is not a country code.
 */
export function toCountry(value) {
  const code = (typeof value === 'string' ? value : '').trim().toUpperCase();
  if (!COUNTRY.test(code) || NOT_A_COUNTRY.has(code)) return null;
  return /** @type {CountryCode} */ (code);
}

/**
 * @param {unknown} value
 * @returns {LanguageCode | null} `'de-DE'` → `'DE'`, `'pt-BR'` → `'PT_BR'`, `'en'` → `'EN'`; `null` otherwise.
 */
export function toLanguage(value) {
  const raw = (typeof value === 'string' ? value : '').trim().replace('-', '_').toUpperCase();
  if (REGIONAL_LANGUAGES.has(raw)) return /** @type {LanguageCode} */ (raw);
  const primary = raw.split('_')[0] ?? '';
  return LANGUAGE.test(primary) ? /** @type {LanguageCode} */ (primary) : null;
}
