/**
 * The runtime configuration. `cfg` is one shared object that every browser module imports; `configure()` replaces its
 * contents in place, so those imports see the new values, and `setCountry()` changes its market keys the same way.
 * Options that end up in query text or attribute names are validated here, once, where they arrive.
 */
/** @import { Money } from './shopify-values.js' */

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
 * @property {boolean | { consent?: 'no-banner' | 'default-banner' | 'custom-banner', proxy?: string }} [shopify]
 *   Shopify's own analytics.
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
 * @property {string} apiVersion A dated Shopify API version.
 * @property {string | undefined} country An ISO country code for `@inContext(country:)`.
 * @property {string | undefined} language A language for `@inContext(language:)`.
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

/** @typedef {{ [Key in keyof TetherConfig]?: TetherConfig[Key] }} TetherOptions */

/** @type {Readonly<TetherConfig>} */
export const DEFAULTS = {
  domain: '',
  token: '',
  apiVersion: '2026-07',
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
 * Metafield identifiers are written into the product fragment's text: a GraphQL fragment can't declare variables, so
 * they can't be sent as variables. Only these characters are let through, which covers Shopify's namespaces and keys.
 */
const METAFIELD_PART = /^[A-Za-z0-9_.-]+$/;
/** A namespace is the same, or an app-reserved one: `$app` or `$app:<name>`. */
const METAFIELD_NAMESPACE = /^(\$app(:[A-Za-z0-9_-]+)?|[A-Za-z0-9_.-]+)$/;

/**
 * @typedef {'imagesFirst' | 'variantsFirst' | 'sellingPlanGroupsFirst' | 'sellingPlansFirst' | 'collectionFirst'
 *   | 'retries' | 'maxAge' | 'lowStock'} CountOption
 */
/**
 * @typedef {'warningText' | 'formatMoney' | 'onLayoutChange' | 'onCartOpen' | 'onCartClose' | 'onLineEnter'
 *   | 'onLineLeave' | 'onValueChange' | 'onError'} HookOption
 */

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
 * @param {unknown} value
 * @returns {string} The store's domain without protocol or path: `https://shop.example/x` → `shop.example`.
 */
function domainOption(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/**
 * @param {unknown} ref
 * @returns {MetafieldIdentifier | null} The identifier of `'namespace.key'` or `{ namespace, key }`, when both parts are
 *   valid identifiers.
 */
export function toMetafieldIdentifier(ref) {
  /** @type {unknown} */
  let namespace;
  /** @type {unknown} */
  let key;
  if (typeof ref === 'string') {
    const dot = ref.indexOf('.');
    namespace = dot > 0 ? ref.slice(0, dot) : '';
    key = ref.slice(dot + 1);
  } else if (typeof ref === 'object' && ref !== null) {
    namespace = Reflect.get(ref, 'namespace');
    key = Reflect.get(ref, 'key');
  }
  if (typeof namespace !== 'string' || typeof key !== 'string') return null;
  return METAFIELD_NAMESPACE.test(namespace) && METAFIELD_PART.test(key) ? { namespace, key } : null;
}

/**
 * @param {unknown} value
 * @returns {MetafieldRef[]} The refs that name a valid identifier, as written; each other one is skipped with a warning.
 */
function metafieldsOption(value) {
  if (!Array.isArray(value)) return invalidOption('metafields', value, []);
  /** @type {MetafieldRef[]} */
  const refs = [];
  for (const ref of /** @type {unknown[]} */ (value)) {
    const identifier = toMetafieldIdentifier(ref);
    if (identifier) refs.push(typeof ref === 'string' ? ref : identifier);
    else invalidOption('metafield', ref, null);
  }
  return refs;
}

/**
 * The configuration `options` describe: defaults filled in, counts, prefix, choices and metafields validated (an
 * invalid value warns and falls back to its default), hooks that aren't functions dropped so callers only check for
 * null.
 *
 * @param {TetherOptions} options
 * @returns {TetherConfig}
 */
export function resolveConfig(options) {
  const domain = domainOption(options.domain);
  const prefix =
    typeof options.prefix === 'string' && PREFIX.test(options.prefix)
      ? options.prefix
      : invalidOption('prefix', options.prefix, DEFAULTS.prefix);
  /** @type {TetherConfig} */
  const resolved = {
    ...DEFAULTS,
    ...options,
    domain,
    prefix,
    storageKey: options.storageKey || `${prefix}:cart:${domain}`,
    metafields: metafieldsOption(options.metafields ?? []),
    checkoutTarget: choiceOption('checkoutTarget', options.checkoutTarget, ['_self', '_blank']),
    defaultPurchase: choiceOption('defaultPurchase', options.defaultPurchase, ['one-time', 'subscription']),
  };
  for (const name of COUNT_OPTIONS) resolved[name] = countOption(name, options[name]);
  for (const name of HOOK_OPTIONS) if (typeof resolved[name] !== 'function') resolved[name] = null;
  if (resolved.apiVersion === 'unstable') {
    warn('apiVersion "unstable" changes without notice. Pin a dated version (e.g. 2026-07).');
  }
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
