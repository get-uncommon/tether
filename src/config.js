/**
 * Runtime config. One shared object, mutated by configure(), read everywhere.
 */

export const DEFAULTS = {
  // Shopify Storefront API
  domain: '',                 // 'your-store.myshopify.com'
  token: '',                  // public Storefront API access token
  apiVersion: '2026-07',
  country: undefined,         // ISO code, e.g. 'NL' -> @inContext(country: NL)
  language: undefined,        // e.g. 'NL' -> @inContext(language: NL)
  locale: undefined,          // Intl locale for money/dates, e.g. 'nl-NL'
  markets: null,              // { detect: true, locales: { de: { country: 'DE', language: 'DE' } }, cookie, remember } (markets.js)

  // Markup
  prefix: 'tether',           // attribute prefix: tether-product, tether-bind, ...
  productPath: '/product',    // Webflow CMS template path for products
  collectionPath: '/collection',

  // Fetching
  metafields: [],             // ['custom.material', { namespace, key }]
  imagesFirst: 25,
  variantsFirst: 100,
  sellingPlanGroupsFirst: 10,
  sellingPlansFirst: 25,
  collectionFirst: 24,
  retries: 2,

  // Cart
  storageKey: null,           // defaults to `tether:cart:<domain>`
  cartDrawerOpenClass: 'is-open',
  openCartOnAdd: true,
  checkoutTarget: '_self',    // '_self' or '_blank'

  // Subscriptions
  defaultPurchase: 'one-time', // 'one-time' | 'subscription'

  // Mounting
  autoMount: true,            // mount document on DOMContentLoaded
  observe: false,             // auto-mount nodes added later (CMS load-more, filters)

  // Formatting
  formatMoney: null,          // (money, locale) => string

  // Hooks (all optional)
  onLayoutChange: null,       // (reason) => void. Default refreshes ScrollTrigger if present
  onCartOpen: null,           // (drawers) => void, e.g. lock scroll
  onCartClose: null,          // (drawers) => void
  onLineEnter: null,          // (node) => void, animate a new cart line in
  onLineLeave: null,          // (node, done) => void, animate out, then call done()
  onValueChange: null,        // (el, previousText) => void, e.g. text scramble
  onError: null,              // (error, context) => void

  debug: false,
};

export const cfg = { ...DEFAULTS };

export function configure(overrides = {}) {
  Object.keys(cfg).forEach((k) => delete cfg[k]);
  Object.assign(cfg, DEFAULTS, overrides);
  if (cfg.domain) cfg.domain = String(cfg.domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!cfg.storageKey) cfg.storageKey = `${cfg.prefix}:cart:${cfg.domain}`;
  if (cfg.apiVersion === 'unstable') warn('apiVersion "unstable" changes without notice. Pin a dated version (e.g. 2026-07).');
  return cfg;
}

export const isConfigured = () => Boolean(cfg.domain && cfg.token);

export function log(...a) { if (cfg.debug) console.log(`[${cfg.prefix}]`, ...a); }
export function warn(...a) { console.warn(`[${cfg.prefix}]`, ...a); }

export function reportError(err, context) {
  warn(context, err && err.message ? err.message : err);
  if (typeof cfg.onError === 'function') {
    try { cfg.onError(err, context); } catch { /* never let a hook break us */ }
  }
}
