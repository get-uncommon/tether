/**
 * The market the page uses: a page built for one market (`<meta name="tether-page-country">`) wins, then the visitor's
 * saved or detected market, then the configured one. Init applies it to `cfg` once. Astro's ClientRouter keeps the
 * script running across pages, so each arrival asks again: the next page may be built for another market, or for none.
 */
import { cfg, log, reportError } from './config.js';
import { loadPart } from './lazy.js';
import { toCountry, toLanguage } from './market-codes.js';
import { readSavedMarket } from './markets.js';
/** @import { TetherOptions } from './config.js' */
/** @import { Market, DetectedMarket } from './markets.js' */
/** @import { SetCountryOptions } from './markets-ui.js' */
/** @import { ShopifyCart } from './cart/store.js' */

/**
 * @typedef {object} ConfiguredMarket The market of the config, before a page's or visitor's market applied.
 * @property {string | undefined} country
 * @property {string | undefined} language
 * @property {string | undefined} locale
 */

/** @type {ConfiguredMarket} */
let configuredMarket = { country: undefined, language: undefined, locale: undefined };

/** Whether the page arrived at last was built for its own market, which the next page without one switches back from. */
let lastPageHadOwnMarket = false;

/**
 * `<meta name="tether-page-country" content="DE">`, with `tether-page-language` and `tether-page-locale`. Never
 * remembered: it belongs to the page, not to the visitor.
 *
 * @returns {Market | null} `null` when the page has no valid country of its own.
 */
function pageMarket() {
  /** @param {string} name */
  const meta = (name) =>
    document.querySelector(`meta[name="${cfg.prefix}-page-${name}"]`)?.getAttribute('content') || undefined;
  const country = toCountry(meta('country'));
  if (!country) return null;
  return { country, language: toLanguage(meta('language')) ?? undefined, locale: meta('locale') };
}

/**
 * Without `markets.detect` only the visitor's saved choice applies, read without loading the markets part.
 *
 * @returns {Promise<Market | DetectedMarket | null>}
 */
async function visitorMarket() {
  const markets = cfg.markets ?? {};
  if (markets.detect === false) return null;
  if (!markets.detect) return markets.remember === false ? null : readSavedMarket();
  try {
    return (await loadPart('markets')).detectMarket(markets);
  } catch (error) {
    reportError(error, 'markets');
    return null;
  }
}

/**
 * Sets `cfg`'s market for the first page, over the configured one.
 *
 * @param {TetherOptions} overrides What `init()` was called with: a `locale` there wins over the visitor's.
 * @returns {Promise<void>}
 */
export async function applyStartMarket(overrides) {
  configuredMarket = { country: cfg.country, language: cfg.language, locale: cfg.locale };
  const page = pageMarket();
  lastPageHadOwnMarket = page !== null;
  if (page) {
    cfg.country = page.country;
    cfg.language = page.language;
    if (page.locale) cfg.locale = page.locale;
    return;
  }
  const market = await visitorMarket();
  if (!market) return;
  if (market.country) cfg.country = market.country;
  if (market.language) cfg.language = market.language;
  if (market.locale && !overrides.locale) cfg.locale = market.locale;
  log('market', market);
}

/**
 * @param {string | undefined} a
 * @param {string | undefined} b
 */
const sameCode = (a, b) => (a ?? '').toUpperCase() === (b ?? '').toUpperCase();

/**
 * The market to switch to on arriving at the current page. A page built for a market switches to it; the first page
 * without one after such a page switches back to the visitor's own choice, else to the configured market.
 *
 * @returns {{ country: string, language: string | undefined, locale: string | undefined } | null} `null` when the page
 *   stays in the market in use.
 */
export function marketForArrival() {
  const page = pageMarket();
  const leftOwnMarket = page === null && lastPageHadOwnMarket;
  lastPageHadOwnMarket = page !== null;
  const target = page ?? (leftOwnMarket ? (readSavedMarket() ?? configuredMarket) : null);
  if (!target?.country) return null;
  if (sameCode(target.country, cfg.country) && sameCode(target.language, cfg.language)) return null;
  return { country: target.country, language: target.language, locale: target.locale };
}

/**
 * `Tether.setCountry('DE')`: loads the markets part on first use.
 *
 * @param {string} code
 * @param {SetCountryOptions} [options]
 * @returns {Promise<ShopifyCart | null>} The cart once everything is in the new market.
 */
export function setCountry(code, options) {
  return loadPart('markets').then((part) => part.setCountry(code, options));
}
