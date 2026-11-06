/**
 * Markets: which country and language prices, currency and translations follow.
 *
 *   markets: {
 *     detect: true,                       // or a list: ['saved', 'server', 'webflow']
 *     locales: {                          // Webflow Localization: locale subdirectory or <html lang>
 *       de: { country: 'DE', language: 'DE', locale: 'de-DE' },
 *       'fr-be': { country: 'BE', language: 'FR' },
 *     },
 *     cookie: 'tether_country',           // a cookie your server or Worker sets (from cf-ipcountry)
 *     remember: true,                     // keep the visitor's tether-country-select choice
 *   }
 *
 * Sources, first match wins per field:
 *   saved   the visitor's own choice (localStorage), from tether-country-select / Tether.setCountry()
 *   server  window.TETHER_COUNTRY, <meta name="tether-country" content="DE">, or the cookie
 *   webflow locale subdirectory (/de/...) or <html lang="de-DE">, through `locales`
 * then the static `country` / `language` config. Without `detect`, only `saved` applies, so a country select keeps
 * working across pages; `detect: false` turns even that off. Tether never calls an IP lookup service: a country from
 * the visitor's IP only comes from the site's own server (see README).
 */
import { cfg } from './config.js';
import { gql } from './client.js';
import { toCountry, toLanguage } from './market-codes.js';
/** @import { MarketsConfig } from './config.js' */
/** @import { CountryCode, LanguageCode } from './market-codes.js' */

/**
 * @typedef {object} Market A market a visitor chose, as `setCountry()` stores it.
 * @property {CountryCode} country
 * @property {LanguageCode | undefined} language
 * @property {string | undefined} locale An `Intl` locale for money and dates.
 */

/** @typedef {'saved' | 'server' | 'webflow'} MarketSource */
/** @typedef {'country' | 'language' | 'locale'} MarketField */
/** @typedef {Partial<Record<MarketField, MarketSource>>} MarketSources */

/**
 * @typedef {object} DetectedMarket The fields detection found, and the source each came from.
 * @property {CountryCode} [country]
 * @property {LanguageCode} [language]
 * @property {string} [locale]
 * @property {MarketSources} [sources] Absent when `detect: false` turns detection off.
 */

/**
 * @typedef {object} MarketEnv What detection reads, passed in so it runs on any document.
 * @property {Pick<Document, 'cookie' | 'querySelector' | 'documentElement'> | null} document
 * @property {Pick<Location, 'pathname'> | null} location
 * @property {Pick<Storage, 'getItem'> | null} storage
 * @property {object} global Where `TETHER_COUNTRY` and `TETHER_LANGUAGE` are read from (`window`).
 */

/** @typedef {{ country?: unknown, language?: unknown, locale?: unknown }} MarketHint A source's raw values. */

/** @typedef {{ isoCode: string, name: string }} NamedCode */
/** @typedef {{ isoCode: string, symbol: string }} Currency */
/** @typedef {NamedCode & { currency: Currency }} LocalizedCountry */
/**
 * @typedef {object} Localization The store's markets, from the Storefront API's `localization`.
 * @property {LocalizedCountry} country The country of the current `@inContext`.
 * @property {NamedCode} language
 * @property {(LocalizedCountry & { availableLanguages: NamedCode[] })[]} availableCountries
 */

/** @type {readonly MarketSource[]} */
const ALL_SOURCES = ['saved', 'server', 'webflow'];
const DEFAULT_COOKIE = 'tether_country';

/** @returns {string} The localStorage key of the visitor's market: `<prefix>:market:<domain>`. */
export const storageKey = () => `${cfg.prefix}:market:${cfg.domain}`;

/**
 * Accessing `localStorage` throws where the browser blocks storage (sandboxed frames, cookies turned off); the visitor
 * then simply has no saved market.
 *
 * @returns {Storage | null}
 */
function localStorageIfAllowed() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** @returns {MarketEnv} The page this script runs on. */
function pageEnv() {
  const hasWindow = typeof window !== 'undefined';
  return {
    document: typeof document !== 'undefined' ? document : null,
    location: hasWindow ? window.location : null,
    storage: localStorageIfAllowed(),
    global: hasWindow ? window : {},
  };
}

/**
 * @param {string} text
 * @returns {unknown} The JSON value, `null` for text that isn't JSON (a key another script wrote).
 */
function parseJsonOrNull(text) {
  try {
    return /** @type {unknown} */ (JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * @param {unknown} value
 * @returns {Market | null} `value` as a market, when it has a valid country. A language or locale that isn't valid is
 *   left out.
 */
function toMarket(value) {
  if (typeof value !== 'object' || value === null) return null;
  const country = toCountry(Reflect.get(value, 'country'));
  if (!country) return null;
  const locale = /** @type {unknown} */ (Reflect.get(value, 'locale'));
  return {
    country,
    language: toLanguage(Reflect.get(value, 'language')) ?? undefined,
    locale: typeof locale === 'string' && locale ? locale : undefined,
  };
}

/**
 * The visitor's saved market (`setCountry()`, `tether-country-select`), validated: storage is written by other tabs,
 * older versions and other scripts too.
 *
 * @param {Pick<Storage, 'getItem'> | null} [storage] Default `localStorage`, `null` where the browser blocks it.
 * @returns {Market | null} `null` when nothing valid is saved.
 */
export function readSavedMarket(storage = localStorageIfAllowed()) {
  const text = storage?.getItem(storageKey());
  return text ? toMarket(parseJsonOrNull(text)) : null;
}

/**
 * @param {Pick<Document, 'cookie'> | null} doc
 * @param {string} name
 * @returns {string | null}
 */
function readCookie(doc, name) {
  if (!doc || !name) return null;
  const cookie = doc.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

/**
 * @param {MarketsConfig['locales']} locales
 * @param {string | undefined} key
 * @returns {MarketHint | null} The entry for `key`, ignoring case.
 */
function lookupLocale(locales, key) {
  if (!locales || !key) return null;
  const wanted = key.toLowerCase();
  const found = Object.keys(locales).find((name) => name.toLowerCase() === wanted);
  return found ? (locales[found] ?? null) : null;
}

/**
 * @param {MarketsConfig} markets
 * @param {MarketEnv} env
 * @returns {MarketHint}
 */
function readServerHint(markets, env) {
  /** @param {string} name */
  const meta = (name) => env.document?.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
  return {
    country:
      Reflect.get(env.global, 'TETHER_COUNTRY') ||
      meta('tether-country') ||
      readCookie(env.document, markets.cookie || DEFAULT_COOKIE),
    language: Reflect.get(env.global, 'TETHER_LANGUAGE') || meta('tether-language'),
  };
}

/**
 * @param {MarketsConfig} markets
 * @param {MarketEnv} env
 * @returns {MarketHint | null}
 */
function readWebflowLocale(markets, env) {
  const segment = (env.location?.pathname ?? '/').split('/').find((part) => part !== '');
  const fromPath = lookupLocale(markets.locales, segment);
  if (fromPath) return fromPath;
  const lang = env.document?.documentElement.getAttribute('lang');
  if (!lang) return null;
  const mapped = lookupLocale(markets.locales, lang) ?? lookupLocale(markets.locales, lang.split('-')[0]);
  if (mapped) return { locale: lang, ...mapped };
  if (markets.locales && markets.strict) return null;
  // Unmapped: the language from <html lang>, a country only from a region subtag (de-CH -> CH).
  const region = lang.split('-')[1];
  return { language: lang, country: region?.length === 2 ? region : null, locale: lang };
}

/**
 * @param {MarketSource} source
 * @param {MarketsConfig} markets
 * @param {MarketEnv} env
 * @returns {MarketHint | null}
 */
function readSource(source, markets, env) {
  switch (source) {
    case 'saved':
      return markets.remember === false ? null : readSavedMarket(env.storage);
    case 'server':
      return readServerHint(markets, env);
    case 'webflow':
      return readWebflowLocale(markets, env);
  }
}

/**
 * @param {unknown} name
 * @returns {name is MarketSource}
 */
const isMarketSource = (name) => ALL_SOURCES.some((source) => source === name);

/**
 * @param {MarketsConfig['detect']} detect
 * @returns {readonly MarketSource[]} Without `detect`, only the visitor's own choice from a country select.
 */
function sourcesFor(detect) {
  if (!detect) return ['saved'];
  if (detect === true) return ALL_SOURCES;
  // The config comes from the page unvalidated, so a single name or an unknown one can arrive here.
  return /** @type {unknown[]} */ ([detect].flat()).filter(isMarketSource);
}

/**
 * The market the page's sources point to. Reads the DOM and storage only, so it can run on any `env`.
 *
 * @param {MarketsConfig | null | undefined} [markets]
 * @param {MarketEnv} [env]
 * @returns {DetectedMarket} Only the fields found; `{}` with `detect: false`.
 */
export function detectMarket(markets = cfg.markets, env = pageEnv()) {
  const config = markets ?? {};
  if (config.detect === false) return {};
  /** @type {MarketSources} */
  const sources = {};
  /** @type {DetectedMarket} */
  const found = { sources };
  for (const source of sourcesFor(config.detect)) {
    const hint = readSource(source, config, env);
    if (!hint) continue;
    const country = toCountry(hint.country);
    const language = toLanguage(hint.language);
    const locale = typeof hint.locale === 'string' && hint.locale ? hint.locale : null;
    if (country && !found.country) {
      found.country = country;
      sources.country = source;
    }
    if (language && !found.language) {
      found.language = language;
      sources.language = source;
    }
    if (locale && !found.locale) {
      found.locale = locale;
      sources.locale = source;
    }
  }
  return found;
}

/**
 * `setItem` throws when storage is full or blocked (Safari's private mode); the choice then lasts for this page only.
 *
 * @param {string} key
 * @param {string} value
 */
function storeIfAllowed(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

/**
 * Saves the visitor's choice for the next pages, unless `markets.remember` is false.
 *
 * @param {{ country: CountryCode, language?: string | null | undefined, locale?: string | null | undefined }} market
 */
export function rememberMarket(market) {
  if (cfg.markets?.remember === false) return;
  const saved = { country: market.country, language: market.language || undefined, locale: market.locale || undefined };
  storeIfAllowed(storageKey(), JSON.stringify(saved));
}

/** @type {Promise<Localization> | null} */
let localizationPromise = null;

/** Forgets the cached localization, for when country names change language. */
export function clearLocalization() {
  localizationPromise = null;
}

const LOCALIZATION_QUERY = `query TetherLocalization {
  localization {
    country { isoCode name currency { isoCode symbol } }
    language { isoCode name }
    availableCountries { isoCode name currency { isoCode symbol } availableLanguages { isoCode name } }
  }
}`;

/**
 * The countries the store sells to (Shopify Markets), with their currency. Cached per page; a failed request is not
 * cached, so the next call tries again.
 *
 * @returns {Promise<Localization>}
 */
export function getLocalization() {
  if (!localizationPromise) {
    /** @type {Promise<{ localization: Localization }>} */
    const loading = gql(LOCALIZATION_QUERY);
    localizationPromise = loading.then(
      (data) => data.localization,
      (/** @type {unknown} */ error) => {
        localizationPromise = null;
        throw error;
      },
    );
  }
  return localizationPromise;
}
