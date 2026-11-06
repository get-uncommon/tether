/**
 * Tether's entry: `window.Tether`, `init()`, `mount()` and the start of the plain `<script>` setup.
 *
 *   <script>window.TETHER_CONFIG = { domain: 'x.myshopify.com', token: '...' }</script>
 *   <script src="tether.min.js" defer></script>
 *
 * With page transitions (Barba, Swup): set `autoMount: false`, call `Tether.init()` once and
 * `Tether.mount(container)` after every page enter.
 */
import { cfg, configure, isConfigured, log, warn, reportError } from './config.js';
import { gql, TetherError, withContext } from './client.js';
import { Cart } from './cart.js';
import { scopes } from './product.js';
import { ListScope, listSelector } from './collection.js';
import {
  getProduct,
  getProducts,
  getRecommendations,
  clearProductCache,
  primeProduct,
  normalizeProductKey,
} from './loader.js';
import * as plans from './selling-plans.js';
import { resolveProductKey } from './status.js';
import { sel, emit, formatMoney, imageUrl } from './dom.js';
import { loadPart, coreModules } from './lazy.js';
import {
  mountedLists,
  liveLists,
  pruneLive,
  within,
  mountProduct,
  hydrateFromPage,
  settleMarket,
  trackMarket,
} from './mounting.js';
import { applyStartMarket, setCountry } from './page-market.js';
import { accountApi, mountAccountIfUsed } from './account-api.js';
import { bindCartControls } from './controls/cart-controls.js';
import { bindDiscountControls } from './controls/discount.js';
import { addGroup, bindExtrasControls } from './controls/extras.js';
import { bindNavigation, rememberDocumentMount } from './controls/navigation.js';
/** @import { TetherConfig, TetherOptions, MarketsConfig } from './config.js' */
/** @import { ShopifyCart } from './cart/store.js' */
/** @import { ProductScope } from './product.js' */
/** @import { DiagnoseOptions } from './diagnose.js' */

export { addGroup, setCountry };

export const VERSION = '0.6.8';

/** The events the analytics part reports, buffered from `init()` until the part has loaded. */
const ANALYTICS_EVENTS = ['product-ready', 'list-ready', 'cart-updated', 'cart-toggled', 'checkout', 'search'];

/** Milliseconds `observe` waits after the last added node, so a burst of additions mounts once. */
const OBSERVE_DEBOUNCE_MS = 50;

/**
 * @typedef {object} TetherGlobals What the page sets on `window` for Tether, and `window.Tether` itself.
 * @property {TetherOptions} [TETHER_CONFIG] The site's config; `configure()` validates it.
 * @property {string} [TETHER_INTEGRATION] Set by a framework integration (Astro) that starts Tether itself.
 * @property {TetherApi} [Tether]
 */

/** @returns {Window & TetherGlobals} */
const pageGlobals = () => window;

/** @type {Promise<TetherApi | null> | null} */
let initPromise = null;

/** @type {MutationObserver | null} */
let observer = null;

/** @type {Event[] | null} The analytics part's queue, created once by the first `init()` with `analytics`. */
let analyticsQueue = null;

/** @type {boolean} The document-wide listeners are bound once, by the first configured `init()`. */
let controlsBound = false;

/**
 * Mounts the lists of `root` and the product scopes in them as they render.
 *
 * @param {ParentNode} root
 * @returns {number} The lists mounted.
 */
function mountLists(root) {
  let count = 0;
  within(root, listSelector()).forEach((el) => {
    if (mountedLists.has(el)) return;
    mountedLists.add(el);
    count++;
    const list = new ListScope(el);
    liveLists.add(list);
    el.addEventListener(`${cfg.prefix}:list-rendered`, (event) => {
      // The list emits this CustomEvent once its products are in the page.
      mount(/** @type {CustomEvent<{ container: ParentNode }>} */ (event).detail.container);
    });
    void trackMarket(list.load());
  });
  return count;
}

/**
 * Loads each optional part `root` uses: the country select, customer accounts and search as you type.
 *
 * @param {ParentNode} root
 */
function mountParts(root) {
  if (within(root, `${sel('country-select')},${sel('country-bind')}`).length) {
    loadPart('markets')
      .then((part) => part.renderCountrySelects(root))
      .catch((/** @type {unknown} */ error) => {
        reportError(error, 'markets');
      });
  }
  mountAccountIfUsed(root);
  if (within(root, sel('search')).length) {
    loadPart('search')
      .then((part) => {
        part.mountSearch(root);
      })
      .catch((/** @type {unknown} */ error) => {
        reportError(error, 'search');
      });
  }
}

/**
 * Mounts every product scope and product list inside `root`. Safe to call repeatedly.
 *
 * @param {ParentNode} [root]
 * @returns {number} The scopes and lists newly mounted.
 */
export function mount(root = document) {
  if (!isConfigured()) return 0;
  if (root === document) rememberDocumentMount();
  // Page transitions detach old roots: they aren't kept alive.
  pruneLive();
  // Products the server rendered into the page need no request.
  hydrateFromPage(root.ownerDocument ?? document);
  let count = mountLists(root);
  within(root, sel('product')).forEach((el) => {
    if (mountProduct(el)) count++;
  });
  mountParts(root);
  settleMarket();
  Cart.render();
  log(`mounted ${count} scope(s)`, root);
  return count;
}

/** Call before a page transition removes the page: closes the cart drawer. */
export function unmount() {
  Cart.close();
}

/**
 * @param {Element | null | undefined} el
 * @returns {ProductScope | null} The product scope `el` is in.
 */
export function getScope(el) {
  const root = el?.closest(sel('product'));
  return root ? (scopes.get(root) ?? null) : null;
}

function bindControls() {
  if (controlsBound) return;
  controlsBound = true;
  bindCartControls();
  bindDiscountControls();
  bindExtrasControls();
  bindNavigation({ ready: () => initPromise ?? Promise.resolve(null), mount, unmount });
}

/** Buffers Tether's events until the analytics part has loaded, so none are missed. */
function startAnalyticsQueue() {
  /** @type {Event[]} */
  const queue = [];
  analyticsQueue = queue;
  ANALYTICS_EVENTS.forEach((name) => {
    document.addEventListener(`${cfg.prefix}:${name}`, (event) => queue.push(event));
  });
  document.addEventListener('astro:page-load', () => queue.push(new CustomEvent(`${cfg.prefix}:page`)));
  loadPart('analytics')
    .then((part) => part.startAnalytics(queue))
    .catch((/** @type {unknown} */ error) => {
      reportError(error, 'analytics');
    });
}

/**
 * A saved cart from another market moves to this one, so its prices match the page's.
 *
 * @param {ShopifyCart | null} cart
 * @returns {Promise<ShopifyCart | null>}
 */
async function cartInPageMarket(cart) {
  const country = cfg.country;
  const cartCountry = cart?.buyerIdentity.countryCode;
  if (!cart || !country || !cartCountry || cartCountry === country) return cart;
  try {
    return await Cart.setBuyerIdentity({ countryCode: country }, { create: false });
  } catch (error) {
    reportError(error, 'cart country');
    return cart;
  }
}

/**
 * Configures Tether (`window.TETHER_CONFIG` with `overrides` over it), applies the visitor's market and loads the
 * cart. A second call without overrides returns the first one's promise.
 *
 * @param {TetherOptions} [overrides]
 * @returns {Promise<TetherApi | null>} `null` without a domain and token, when Tether stays idle.
 */
export function init(overrides = {}) {
  if (initPromise && !Object.keys(overrides).length) return initPromise;
  configure({ ...pageGlobals().TETHER_CONFIG, ...overrides });
  if (!isConfigured()) {
    warn('TETHER_CONFIG is missing domain or token. Tether is idle.');
    initPromise = Promise.resolve(null);
    return initPromise;
  }
  bindControls();
  if (cfg.observe) startObserver();
  if (cfg.analytics && !analyticsQueue) startAnalyticsQueue();
  initPromise = applyStartMarket(overrides)
    .then(() => Cart.init())
    .then(cartInPageMarket)
    .then((cart) => {
      emit('ready', { cart });
      return api;
    });
  return initPromise;
}

/** `observe`: mounts the elements added to the page later. */
function startObserver() {
  if (observer || typeof MutationObserver === 'undefined') return;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {Set<Element>} */
  const queued = new Set();
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof window.Element) queued.add(node);
      });
    });
    clearTimeout(timer);
    timer = setTimeout(() => {
      queued.forEach((node) => {
        if (node.isConnected) mount(node);
      });
      queued.clear();
    }, OBSERVE_DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * @param {MarketsConfig | null} [markets] Default `markets` of the config.
 */
const detectMarket = (markets) => loadPart('markets').then((part) => part.detectMarket(markets ?? cfg.markets));

const getLocalization = () => loadPart('markets').then((part) => part.getLocalization());

/** @param {Omit<DiagnoseOptions, 'version'>} [options] */
const diagnose = (options) => loadPart('diagnose').then((part) => part.diagnose({ ...options, version: VERSION }));

/**
 * Listens to the Tether event `<prefix>:<name>`.
 *
 * @param {string} name
 * @param {(detail: unknown, event: CustomEvent) => void} listener
 * @returns {() => void} Stops listening.
 */
function on(name, listener) {
  /** @param {Event} event */
  const handler = (event) => {
    const custom = /** @type {CustomEvent} Tether's events are CustomEvents. */ (event);
    listener(custom.detail, custom);
  };
  document.addEventListener(`${cfg.prefix}:${name}`, handler);
  return () => {
    document.removeEventListener(`${cfg.prefix}:${name}`, handler);
  };
}

export const api = {
  VERSION,
  init,
  mount,
  unmount,
  /** @returns {TetherConfig} */
  get config() {
    return cfg;
  },
  /** @returns {Promise<TetherApi | null>} */
  get ready() {
    return initPromise ?? Promise.resolve(null);
  },
  query: gql,
  withContext,
  cart: Cart,
  getProduct,
  getProducts,
  getRecommendations,
  getScope,
  addGroup,
  account: accountApi,
  primeProduct,
  normalizeProductKey,
  clearProductCache,
  formatMoney,
  imageUrl,
  plans,
  TetherError,
  resolveProductKey,
  setCountry,
  detectMarket,
  getLocalization,
  diagnose,
  __core: coreModules,
  // The `<script>` build's parts register here when their file has loaded.
  __parts: /** @type {Record<string, unknown>} */ ({}),
  on,
};

/** @typedef {typeof api} TetherApi */

export default api;

/**
 * The plain `<script>` setup starts by itself, unless `autoMount: false` or a framework integration (Astro), which
 * starts Tether itself.
 */
function autoStart() {
  const globals = pageGlobals();
  globals.Tether = api;
  if (!globals.TETHER_CONFIG || globals.TETHER_CONFIG.autoMount === false || globals.TETHER_INTEGRATION) return;
  const start = () => {
    init()
      .then(() => mount(document))
      .catch((/** @type {unknown} */ error) => {
        reportError(error, 'init');
      });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') autoStart();
