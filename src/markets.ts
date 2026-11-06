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
import { MARKET_SOURCES, cfg, parseMarkets } from './config.ts';
import { toCountry, toLanguage } from './market-codes.ts';
import { getStored, setStored } from './storage.ts';
import type { MarketsConfig } from './config.ts';
import type { CountryCode, LanguageCode } from './market-codes.ts';

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

/** A source's raw values. */
interface MarketHint {
  country?: unknown;
  language?: unknown;
  locale?: unknown;
}

interface NamedCode {
  isoCode: string;
  name: string;
}

interface Currency {
  isoCode: string;
  symbol: string;
}

export type LocalizedCountry = NamedCode & { currency: Currency };

/** The store's markets, from the Storefront API's `localization`. */
export interface Localization {
  /** The country of the current `@inContext`. */
  country: LocalizedCountry;
  language: NamedCode;
  availableCountries: (LocalizedCountry & { availableLanguages: NamedCode[] })[];
}

const DEFAULT_COOKIE = 'tether_country';

/** The localStorage key of the visitor's market: `<prefix>:market:<domain>`. */
export const storageKey = (): string => `${cfg.prefix}:market:${cfg.domain}`;

const pageStorage: Pick<Storage, 'getItem'> = { getItem: (key) => getStored(key) };

/** The page this script runs on. */
function pageEnv(): MarketEnv {
  const hasWindow = typeof window !== 'undefined';
  return {
    document: typeof document !== 'undefined' ? document : null,
    location: hasWindow ? window.location : null,
    storage: pageStorage,
    global: hasWindow ? window : {},
  };
}

/** The JSON value of `text`, `null` for text that isn't JSON (a key another script wrote). */
function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** `value` as a market, when it has a valid country. A language or locale that isn't valid is left out. */
function toMarket(value: unknown): Market | null {
  if (typeof value !== 'object' || value === null) return null;
  const country = toCountry(Reflect.get(value, 'country'));
  if (!country) return null;
  const locale: unknown = Reflect.get(value, 'locale');
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
 * @param storage Default `localStorage`.
 * @returns `null` when nothing valid is saved.
 */
export function readSavedMarket(storage: Pick<Storage, 'getItem'> = pageStorage): Market | null {
  const text = storage.getItem(storageKey());
  return text ? toMarket(parseJsonOrNull(text)) : null;
}

function readCookie(doc: Pick<Document, 'cookie'> | null, name: string): string | null {
  if (!doc || !name) return null;
  const cookie = doc.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

/** The entry of `locales` for `key`, ignoring case. */
function lookupLocale(locales: MarketsConfig['locales'], key: string | undefined): MarketHint | null {
  if (!locales || !key) return null;
  const wanted = key.toLowerCase();
  const found = Object.keys(locales).find((name) => name.toLowerCase() === wanted);
  return found ? (locales[found] ?? null) : null;
}

function readServerHint(markets: MarketsConfig, env: MarketEnv): MarketHint {
  const meta = (name: string) => env.document?.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
  const globalCountry: unknown = Reflect.get(env.global, 'TETHER_COUNTRY');
  const globalLanguage: unknown = Reflect.get(env.global, 'TETHER_LANGUAGE');
  const pageCountry = meta('tether-country') || readCookie(env.document, markets.cookie || DEFAULT_COOKIE);
  return {
    country: globalCountry || pageCountry,
    language: globalLanguage || meta('tether-language'),
  };
}

function readWebflowLocale(markets: MarketsConfig, env: MarketEnv): MarketHint | null {
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

function readSource(source: MarketSource, markets: MarketsConfig, env: MarketEnv): MarketHint | null {
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
 * @param detect Validated: a list holds only known sources.
 * @returns Without `detect`, only the visitor's own choice from a country select.
 */
function sourcesFor(detect: MarketsConfig['detect']): readonly MarketSource[] {
  if (!detect) return ['saved'];
  return detect === true ? MARKET_SOURCES : detect;
}

/**
 * The market the page's sources point to. Reads the DOM and storage only, so it can run on any `env`.
 *
 * @returns Only the fields found; `{}` with `detect: false`.
 */
export function detectMarket(
  markets: MarketsConfig | null | undefined = cfg.markets,
  env: MarketEnv = pageEnv(),
): DetectedMarket {
  // The config's own `markets` was validated by `configure()`; one passed in by the site's code is validated here.
  const config = (markets === cfg.markets ? markets : parseMarkets(markets)) ?? {};
  if (config.detect === false) return {};
  const sources: MarketSources = {};
  const found: DetectedMarket = { sources };
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

/** Saves the visitor's choice for the next pages, unless `markets.remember` is false. */
export function rememberMarket(market: {
  country: CountryCode;
  language?: string | null | undefined;
  locale?: string | null | undefined;
}): void {
  if (cfg.markets?.remember === false) return;
  const saved = { country: market.country, language: market.language || undefined, locale: market.locale || undefined };
  setStored(storageKey(), JSON.stringify(saved));
}
