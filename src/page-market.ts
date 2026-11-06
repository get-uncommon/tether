/**
 * The market the page uses: a page built for one market (`<meta name="tether-page-country">`) wins, then the visitor's
 * saved or detected market, then the configured one. Init applies it to `cfg` once. Astro's ClientRouter keeps the
 * script running across pages, so each arrival asks again: the next page may be built for another market, or for none.
 */
import { cfg, log, reportError } from './config.ts';
import { loadPart } from './lazy.ts';
import { toCountry, toLanguage } from './market-codes.ts';
import { readSavedMarket } from './markets.ts';
import type { TetherOptions } from './config.ts';
import type { Market, DetectedMarket } from './markets.ts';
import type { Parts } from './lazy.ts';
import type { ShopifyCart } from './cart/store.ts';

export type SetCountryOptions = Parameters<Parts['markets']['setCountry']>[1];

/** The market of the config, before a page's or visitor's market applied. */
interface ConfiguredMarket {
  country: string | undefined;
  language: string | undefined;
  locale: string | undefined;
}

let configuredMarket: ConfiguredMarket = { country: undefined, language: undefined, locale: undefined };

/**
 * Whether the page arrived at last was built for its own market, which the next page without one switches back from.
 */
let lastPageHadOwnMarket = false;

/**
 * `<meta name="tether-page-country" content="DE">`, with `tether-page-language` and `tether-page-locale`. Never
 * remembered: it belongs to the page, not to the visitor.
 *
 * @returns `null` when the page has no valid country of its own.
 */
function pageMarket(): Market | null {
  const meta = (name: string) =>
    document.querySelector(`meta[name="${cfg.prefix}-page-${name}"]`)?.getAttribute('content') || undefined;
  const country = toCountry(meta('country'));
  if (!country) return null;
  return { country, language: toLanguage(meta('language')) ?? undefined, locale: meta('locale') };
}

/**
 * Without `markets.detect` only the visitor's saved choice applies, read without loading the markets part.
 */
async function visitorMarket(): Promise<Market | DetectedMarket | null> {
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
 * @param overrides What `init()` was called with: a `locale` there wins over the visitor's.
 */
export async function applyStartMarket(overrides: TetherOptions): Promise<void> {
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

const sameCode = (a: string | undefined, b: string | undefined) => (a ?? '').toUpperCase() === (b ?? '').toUpperCase();

/**
 * The market to switch to on arriving at the current page. A page built for a market switches to it; the first page
 * without one after such a page switches back to the visitor's own choice, else to the configured market.
 *
 * @returns `null` when the page stays in the market in use.
 */
export function marketForArrival(): {
  country: string;
  language: string | undefined;
  locale: string | undefined;
} | null {
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
 * @returns The cart once everything is in the new market.
 */
export function setCountry(code: string, options?: SetCountryOptions): Promise<ShopifyCart | null> {
  return loadPart('markets').then((part) => part.setCountry(code, options));
}
