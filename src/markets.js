// @ts-nocheck
/**
 * Markets: which country/language prices, currency and translations follow.
 *
 *   markets: {
 *     detect: true,                       // or a list: ['saved', 'server', 'webflow']
 *     locales: {                          // Webflow Localization: locale subdirectory or <html lang>
 *       de: { country: 'DE', language: 'DE', locale: 'de-DE' },
 *       'fr-be': { country: 'BE', language: 'FR' },
 *     },
 *     cookie: 'tether_country',           // a cookie your server/Worker sets (e.g. from cf-ipcountry)
 *     remember: true,                     // keep the visitor's tether-country-select choice
 *   }
 *
 * Sources, first match wins per field:
 *   saved   the visitor's own choice (localStorage), from tether-country-select / Tether.setCountry()
 *   server  window.TETHER_COUNTRY, <meta name="tether-country" content="DE">, or the cookie
 *   webflow locale subdirectory (/de/...) or <html lang="de-DE">, through `locales`
 * then the static `country` / `language` config. Without `detect`, only `saved` applies
 * (so a country select keeps working across pages); `detect: false` turns even that off. Tether never calls an IP lookup service:
 * a country from the visitor's IP only comes from your own server (see README).
 */
import { cfg } from './config.js';
import { gql } from './client.js';

const COUNTRY = /^[A-Z]{2}$/;
// Shopify LanguageCode values with a region; others are the plain ISO 639-1 code.
const REGIONAL_LANGUAGES = new Set(['PT_BR', 'PT_PT', 'ZH_CN', 'ZH_TW']);

export const storageKey = () => `${cfg.prefix}:market:${cfg.domain}`;

const defaultEnv = () => ({
  document: typeof document !== 'undefined' ? document : null,
  location: typeof window !== 'undefined' ? window.location : null,
  storage: (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })(),
  global: typeof window !== 'undefined' ? window : {},
});

export function toCountry(v) {
  const c = String(v || '')
    .trim()
    .toUpperCase();
  return COUNTRY.test(c) && c !== 'XX' && c !== 'T1' ? c : null; // XX/T1: Cloudflare's unknown/Tor
}

/** 'de-DE' -> 'DE', 'pt-BR' -> 'PT_BR', 'en' -> 'EN'. */
export function toLanguage(v) {
  const raw = String(v || '')
    .trim()
    .replace('-', '_')
    .toUpperCase();
  if (!raw) return null;
  if (REGIONAL_LANGUAGES.has(raw)) return raw;
  const primary = raw.split('_')[0];
  return /^[A-Z]{2,3}$/.test(primary) ? primary : null;
}

function readCookie(doc, name) {
  if (!doc || !name) return null;
  const hit = String(doc.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

const lookup = (locales, key) => {
  if (!locales || !key) return null;
  const k = String(key).toLowerCase();
  const found = Object.keys(locales).find((x) => x.toLowerCase() === k);
  return found ? locales[found] : null;
};

const readers = {
  saved(m, env) {
    if (m.remember === false || !env.storage) return null;
    try {
      return JSON.parse(env.storage.getItem(storageKey()) || 'null');
    } catch {
      return null;
    }
  },
  server(m, env) {
    const meta = (name) => env.document?.querySelector?.(`meta[name="${name}"]`)?.getAttribute('content');
    const country =
      env.global.TETHER_COUNTRY || meta('tether-country') || readCookie(env.document, m.cookie || 'tether_country');
    const language = env.global.TETHER_LANGUAGE || meta('tether-language');
    return { country, language };
  },
  webflow(m, env) {
    const segment = (env.location?.pathname || '/').split('/').filter(Boolean)[0];
    const fromPath = lookup(m.locales, segment);
    if (fromPath) return fromPath;
    const lang = env.document?.documentElement?.getAttribute('lang');
    if (!lang) return null;
    const mapped = lookup(m.locales, lang) || lookup(m.locales, lang.split('-')[0]);
    if (mapped) return { locale: lang, ...mapped };
    if (m.locales && m.strict) return null;
    // Unmapped: language from <html lang>, country only from a region subtag (de-CH -> CH).
    const region = lang.split('-')[1];
    return { language: lang, country: region && region.length === 2 ? region : null, locale: lang };
  },
};

/**
 * Returns { country, language, locale, sources } with only the fields found.
 * Pure apart from reading the DOM/storage: easy to test.
 */
export function detectMarket(markets = cfg.markets, env = defaultEnv()) {
  const m = markets || {};
  if (m.detect === false) return {};
  // Without detect, only the visitor's own choice (from a country select) is applied.
  const list = !m.detect ? ['saved'] : m.detect === true ? ['saved', 'server', 'webflow'] : [].concat(m.detect);
  markets = m;
  const out = { sources: {} };
  list.forEach((name) => {
    const r = readers[name]?.(markets, env);
    if (!r) return;
    const vals = { country: toCountry(r.country), language: toLanguage(r.language), locale: r.locale || null };
    Object.entries(vals).forEach(([k, v]) => {
      if (v && !out[k]) {
        out[k] = v;
        out.sources[k] = name;
      }
    });
  });
  return out;
}

export function rememberMarket(market) {
  if (cfg.markets?.remember === false) return;
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify({
        country: market.country,
        language: market.language || undefined,
        locale: market.locale || undefined,
      }),
    );
  } catch {
    /* private mode */
  }
}

let localizationPromise = null;
export function clearLocalization() {
  localizationPromise = null;
}

/** Countries the store sells to (Shopify Markets), with currency. Cached per page. */
export function getLocalization() {
  if (!localizationPromise) {
    localizationPromise = gql(`query TetherLocalization {
  localization {
    country { isoCode name currency { isoCode symbol } }
    language { isoCode name }
    availableCountries { isoCode name currency { isoCode symbol } availableLanguages { isoCode name } }
  }
}`)
      .then((d) => d.localization)
      .catch((err) => {
        localizationPromise = null;
        throw err;
      });
  }
  return localizationPromise;
}
