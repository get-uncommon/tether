/**
 * The runtime configuration. `cfg` is one shared object that every browser module imports; `configure()` replaces its
 * contents in place, so those imports see the new values, and `setCountry()` changes its market keys the same way.
 * Every option is validated here, once, where it arrives: values that end up in query text, URLs, attribute names or
 * storage keys never reach the code that uses them unchecked.
 */
import { STOREFRONT_API_VERSION } from '../server/src/shared/api-versions.js';
import { isQuarterlyVersion } from './api-version.js';
import { accountOption, analyticsOption, domainOption, marketsOption, metafieldsOption } from './config-sections.js';
import { toCountry, toLanguage } from './market-codes.js';
/** @import { Money } from './shopify-values.js' */
/** @import { CountryCode, LanguageCode } from './market-codes.js' */

/**
 * @typedef {object} MarketsConfig Where the visitor's market comes from (`markets.js`).
 * @property {boolean | ('saved' | 'server' | 'webflow')[]} [detect] true: every source; a list: only those.
 * @property {Record<string, { country?: string, language?: string, locale?: string }>} [locales] Webflow locale
 *   (subdirectory or html lang) to market.
 * @property {string} [cookie] The cookie a server sets with the visitor's country.
 * @property {boolean} [remember] Remember the visitor's choice (default true).
 * @property {boolean} [strict] With `locales`: ignore an html lang that isn't in the map.
 */

/**
 * @typedef {object} AnalyticsConfig The optional analytics part.
 * @property {boolean | string} [dataLayer] GA4/GTM events, into `window.dataLayer` or the named array.
 * @property {boolean | { consent?: 'no-banner' | 'default-banner' | 'custom-banner', proxy?: boolean }} [shopify]
 *   Shopify's own analytics. `proxy`: the site serves the Storefront API on its own domain.
 * @property {(name: string, data: Record<string, unknown>) => void} [onEvent]
 */

/**
 * @typedef {object} AccountConfig The optional customer accounts part.
 * @property {string} [clientId] Browser mode: the Customer Account API client id.
 * @property {string} [server] Server mode: the Worker's account routes, a URL or a path on this site.
 * @property {string} [orderUrl] The site's own order page, with `{id}` for the numeric order id.
 * @property {string} [subscriptionsUrl] Shopify's subscription management page.
 * @property {string} [paymentUrl] A separate page for payment methods (default `subscriptionsUrl`).
 * @property {string} [callbackUrl] Where Shopify sends the visitor after login (default the current page).
 * @property {string} [logoutUrl] Where Shopify sends the visitor after logout (default the home page).
 * @property {boolean} [remember] Keep the login across tabs and restarts (localStorage, not sessionStorage).
 * @property {string} [tokenUrl] The site's own token endpoint, for when the browser can't call Shopify's.
 * @property {string} [shopDomain] The *.myshopify.com domain, when `domain` is another one.
 * @property {string} [locale] The language of Shopify's login pages.
 * @property {(url: string) => void} [navigate] Replaces `location.assign` for the login redirect (popups, tests).
 */

/** @typedef {{ namespace: string, key: string }} MetafieldIdentifier */
/** @typedef {string | MetafieldIdentifier} MetafieldRef `'namespace.key'` or the identifier itself. */
/** @typedef {{ code: string, message: string, target?: string }} CartWarning Shopify's note on a cart change. */
/** @typedef {'_self' | '_blank'} CheckoutTarget */
/** @typedef {'one-time' | 'subscription'} PurchaseKind */

/**
 * @typedef {object} TetherConfig Every option, with its default filled in.
 * @property {string} domain The store's domain, without protocol or path.
 * @property {string} token The public Storefront API access token.
 * @property {string} apiVersion A dated Shopify API version (or `unstable`, with a warning).
 * @property {CountryCode | undefined} country The market's country, for `@inContext(country:)`.
 * @property {LanguageCode | undefined} language The market's language, for `@inContext(language:)`.
 * @property {string | undefined} locale An `Intl` locale for money and dates.
 * @property {MarketsConfig | null} markets
 * @property {string} prefix The attribute prefix: `tether` reads `tether-product`, `tether-bind`.
 * @property {string} productPath A folder (`/product`) or a template with `{handle}` / `{id}`.
 * @property {string} collectionPath
 * @property {MetafieldRef[]} metafields The product metafields to fetch.
 * @property {number} imagesFirst
 * @property {number} variantsFirst
 * @property {number} sellingPlanGroupsFirst
 * @property {number} sellingPlansFirst
 * @property {number} collectionFirst
 * @property {number} retries Retries of a request that failed on the network, a 429/5xx or Shopify's throttling.
 * @property {boolean} revalidate Refresh server-rendered products once in the background.
 * @property {string} storageKey The localStorage key of the cart id (default `<prefix>:cart:<domain>`).
 * @property {string} cartDrawerOpenClass
 * @property {boolean} openCartOnAdd
 * @property {boolean} cartFocus Move focus into the open cart, keep Tab inside it, restore it on close.
 * @property {CheckoutTarget} checkoutTarget
 * @property {PurchaseKind} defaultPurchase
 * @property {boolean} variantUrl `?variant=` follows the visitor's choice on the page's main product.
 * @property {number} maxAge Seconds a Shopify answer may be cached; 0 leaves it to Shopify, which can be hours.
 * @property {number} lowStock `tether-show="low-stock"` at this many or fewer (needs inventory access).
 * @property {number} searchDelay Milliseconds the search part waits after the last keystroke.
 * @property {boolean} autoMount Mount the document on DOMContentLoaded.
 * @property {boolean} observe Mount elements added later (CMS load more, filters).
 * @property {boolean} astro Mount on Astro's `astro:page-load` and close the cart on navigation.
 * @property {string | null} partsUrl The folder of the optional parts, for the `<script>` build.
 * @property {AnalyticsConfig | null} analytics
 * @property {AccountConfig | null} account
 * @property {((warning: CartWarning) => string | null | undefined) | null} warningText The site's text for a cart
 *   warning; nothing keeps Shopify's.
 * @property {((money: Money, locale: string | undefined) => string) | null} formatMoney
 * @property {((reason: string) => void) | null} onLayoutChange Default: `ScrollTrigger.refresh()` when present.
 * @property {((drawers: HTMLElement[]) => void) | null} onCartOpen
 * @property {((drawers: HTMLElement[]) => void) | null} onCartClose
 * @property {((node: HTMLElement) => void) | null} onLineEnter
 * @property {((node: HTMLElement, done: () => void) => void) | null} onLineLeave Animates a line out, then calls
 *   `done()`.
 * @property {((element: HTMLElement, previousText: string) => void) | null} onValueChange
 * @property {((error: unknown, context: string) => void) | null} onError Every failure that reaches the visitor.
 * @property {boolean} debug
 */

/**
 * What a site passes: any option, the market as the codes people write (`'de'`, `'pt-BR'`).
 *
 * @typedef {{ [Key in Exclude<keyof TetherConfig, 'country' | 'language'>]?: TetherConfig[Key] }
 *   & { country?: string | undefined, language?: string | undefined }} TetherOptions
 */

/** @type {Readonly<TetherConfig>} */
export const DEFAULTS = {
  domain: '',
  token: '',
  apiVersion: STOREFRONT_API_VERSION,
  country: undefined,
  language: undefined,
  locale: undefined,
  markets: null,
  prefix: 'tether',
  productPath: '/product',
  collectionPath: '/collection',
  metafields: [],
  imagesFirst: 25,
  variantsFirst: 100,
  sellingPlanGroupsFirst: 10,
  sellingPlansFirst: 25,
  collectionFirst: 24,
  retries: 2,
  revalidate: true,
  storageKey: '',
  cartDrawerOpenClass: 'is-open',
  openCartOnAdd: true,
  cartFocus: true,
  checkoutTarget: '_self',
  defaultPurchase: 'one-time',
  variantUrl: false,
  maxAge: 60,
  lowStock: 5,
  searchDelay: 150,
  autoMount: true,
  observe: false,
  astro: true,
  partsUrl: null,
  analytics: null,
  account: null,
  warningText: null,
  formatMoney: null,
  onLayoutChange: null,
  onCartOpen: null,
  onCartClose: null,
  onLineEnter: null,
  onLineLeave: null,
  onValueChange: null,
  onError: null,
  debug: false,
};

/** @type {TetherConfig} */
export const cfg = { ...DEFAULTS };

/** The prefix becomes part of attribute names, CSS selectors and event names, so it is kept to those characters. */
const PREFIX = /^[a-z][a-z0-9-]*$/;

/**
 * @typedef {'imagesFirst' | 'variantsFirst' | 'sellingPlanGroupsFirst' | 'sellingPlansFirst' | 'collectionFirst'
 *   | 'retries' | 'maxAge' | 'lowStock' | 'searchDelay'} CountOption
 */
/**
 * @typedef {'warningText' | 'formatMoney' | 'onLayoutChange' | 'onCartOpen' | 'onCartClose' | 'onLineEnter'
 *   | 'onLineLeave' | 'onValueChange' | 'onError'} HookOption
 */

/**
 * @typedef {'revalidate' | 'openCartOnAdd' | 'cartFocus' | 'variantUrl' | 'autoMount' | 'observe' | 'astro' | 'debug'}
 *   SwitchOption
 */
/** @typedef {'token' | 'productPath' | 'collectionPath' | 'cartDrawerOpenClass'} TextOption */

/** @type {readonly SwitchOption[]} */
const SWITCH_OPTIONS = [
  'revalidate',
  'openCartOnAdd',
  'cartFocus',
  'variantUrl',
  'autoMount',
  'observe',
  'astro',
  'debug',
];
/** @type {readonly TextOption[]} */
const TEXT_OPTIONS = ['token', 'productPath', 'collectionPath', 'cartDrawerOpenClass'];

/** @type {readonly CountOption[]} Options that are written into queries as list sizes or used as counts. */
const COUNT_OPTIONS = [
  'imagesFirst',
  'variantsFirst',
  'sellingPlanGroupsFirst',
  'sellingPlansFirst',
  'collectionFirst',
  'retries',
  'maxAge',
  'lowStock',
  'searchDelay',
];
/** @type {readonly HookOption[]} */
const HOOK_OPTIONS = [
  'warningText',
  'formatMoney',
  'onLayoutChange',
  'onCartOpen',
  'onCartClose',
  'onLineEnter',
  'onLineLeave',
  'onValueChange',
  'onError',
];

/**
 * @template T
 * @param {string} name
 * @param {unknown} value
 * @param {T} fallback
 * @returns {T} `fallback`, with a warning unless `value` was left out.
 */
function invalidOption(name, value, fallback) {
  if (value !== undefined) warn(`invalid ${name} ${JSON.stringify(value)}: using ${JSON.stringify(fallback)}`);
  return fallback;
}

/**
 * @param {CountOption} name
 * @param {unknown} value
 * @returns {number} `value` when it is a non-negative integer, else the default.
 */
function countOption(name, value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return invalidOption(name, value, DEFAULTS[name]);
}

/**
 * @param {SwitchOption} name
 * @param {unknown} value
 * @returns {boolean}
 */
function switchOption(name, value) {
  return typeof value === 'boolean' ? value : invalidOption(name, value, DEFAULTS[name]);
}

/**
 * @param {TextOption} name
 * @param {unknown} value
 * @returns {string}
 */
function textOption(name, value) {
  return typeof value === 'string' ? value : invalidOption(name, value, DEFAULTS[name]);
}

/**
 * @param {unknown} value
 * @returns {string | undefined} An `Intl` locale as written, `undefined` for one `Intl` doesn't accept.
 */
function localeOption(value) {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    if (typeof value === 'string' && Intl.getCanonicalLocales(value).length) return value;
  } catch {
    // RangeError: not a locale (falls through to the warning).
  }
  dropped('locale', value);
  return undefined;
}

/**
 * @param {unknown} value
 * @returns {string | null} The folder of the optional parts as written; lazy-iife.js checks where it points.
 */
function partsUrlOption(value) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? value : invalidOption('partsUrl', value, null);
}

/**
 * @template {string} Choice
 * @param {string} name
 * @param {unknown} value
 * @param {readonly [Choice, ...Choice[]]} choices The first one is the default.
 * @returns {Choice}
 */
function choiceOption(name, value, choices) {
  return choices.find((choice) => choice === value) ?? invalidOption(name, value, choices[0]);
}

/**
 * Warns about a nested option that was left out (`config-sections.js`).
 *
 * @param {string} name
 * @param {unknown} value
 */
const dropped = (name, value) => {
  warn(`invalid ${name} ${JSON.stringify(value)}: ignored`);
};

/**
 * @param {unknown} value
 * @returns {string} A quarterly version, or `unstable` with a warning; the default for anything else, which would
 *   be written into the endpoint's path.
 */
function apiVersionOption(value) {
  if (value === 'unstable') {
    warn('apiVersion "unstable" changes without notice. Pin a dated version (e.g. 2026-07).');
    return value;
  }
  return isQuarterlyVersion(value) ? value : invalidOption('apiVersion', value, DEFAULTS.apiVersion);
}

/**
 * @template Code
 * @param {string} name
 * @param {unknown} value
 * @param {(value: unknown) => Code | null} parse
 * @returns {Code | undefined}
 */
function codeOption(name, value, parse) {
  if (value === undefined || value === null || value === '') return undefined;
  const code = parse(value);
  if (code !== null) return code;
  dropped(name, value);
  return undefined;
}

/**
 * The configuration `options` describe: defaults filled in, every value validated (an invalid one warns and falls
 * back to its default), hooks that aren't functions dropped so callers only check for null.
 *
 * @param {TetherOptions | Readonly<Record<string, unknown>>} options What the site set, or any object (the server
 *   helpers take their options from code and `.env`).
 * @returns {TetherConfig}
 */
export function resolveConfig(options) {
  const domain = domainOption(options.domain, dropped);
  const prefix =
    typeof options.prefix === 'string' && PREFIX.test(options.prefix)
      ? options.prefix
      : invalidOption('prefix', options.prefix, DEFAULTS.prefix);
  /** @type {TetherConfig} */
  const resolved = {
    ...DEFAULTS,
    ...options,
    domain,
    apiVersion: apiVersionOption(options.apiVersion),
    country: codeOption('country', options.country, toCountry),
    locale: localeOption(options.locale),
    partsUrl: partsUrlOption(options.partsUrl),
    language: codeOption('language', options.language, toLanguage),
    markets: marketsOption(options.markets, dropped),
    analytics: analyticsOption(options.analytics, dropped),
    account: accountOption(options.account, dropped),
    prefix,
    storageKey:
      typeof options.storageKey === 'string' && options.storageKey ? options.storageKey : `${prefix}:cart:${domain}`,
    metafields: metafieldsOption(options.metafields ?? [], dropped),
    checkoutTarget: choiceOption('checkoutTarget', options.checkoutTarget, ['_self', '_blank']),
    defaultPurchase: choiceOption('defaultPurchase', options.defaultPurchase, ['one-time', 'subscription']),
  };
  for (const name of COUNT_OPTIONS) resolved[name] = countOption(name, options[name]);
  for (const name of SWITCH_OPTIONS) resolved[name] = switchOption(name, options[name]);
  for (const name of TEXT_OPTIONS) resolved[name] = textOption(name, options[name]);
  for (const name of HOOK_OPTIONS) if (typeof resolved[name] !== 'function') resolved[name] = null;
  return resolved;
}

/**
 * Replaces the shared configuration with `options` over the defaults (see `resolveConfig`).
 *
 * @param {TetherOptions} [options]
 * @returns {TetherConfig} The shared `cfg`.
 */
export function configure(options = {}) {
  const resolved = resolveConfig(options);
  for (const key of Object.keys(cfg)) {
    if (!(key in resolved)) Reflect.deleteProperty(cfg, key);
  }
  return Object.assign(cfg, resolved);
}

/** @returns {boolean} True once a domain and a token are set. */
export const isConfigured = () => Boolean(cfg.domain && cfg.token);

/** @param {...unknown} args */
export function log(...args) {
  if (cfg.debug) console.log(`[${cfg.prefix}]`, ...args);
}

/** @param {...unknown} args */
export function warn(...args) {
  console.warn(`[${cfg.prefix}]`, ...args);
}

/**
 * Logs a failure that reaches the visitor and hands it to `onError`. A throwing `onError` is logged, never rethrown:
 * the site's hook must not break the render that reported the failure.
 *
 * @param {unknown} error
 * @param {string} context What failed, e.g. `product coffee-box`.
 */
export function reportError(error, context) {
  warn(context, error instanceof Error && error.message ? error.message : error);
  if (!cfg.onError) return;
  try {
    cfg.onError(error, context);
  } catch (hookError) {
    warn('onError threw', hookError);
  }
}
