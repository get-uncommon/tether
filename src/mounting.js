/**
 * The product scopes and lists on the page: mounting a product root, the live roots a country switch re-renders, and
 * the products the server rendered into the page. Shared by `index.js` and the optional markets part.
 */
import { cfg, log, warn, reportError } from './config.js';
import { ProductScope, scopes as untypedScopes, rememberOptionNames } from './product.js';
import { listSelector } from './collection.js';
import { getProduct, takeStale, refreshProducts, hydrateProducts } from './loader.js';
import { resolveProductKey, setScopeStatus, isNotFound } from './status.js';
import { attr, get, qsa, emit } from './dom.js';
/** @import { Product } from './fragments.js' */

/** @typedef {{ product: Product, update: (product: Product) => void }} RenderedProduct A mounted `ProductScope`. */
/** @typedef {{ root: Element, load: (more?: boolean) => Promise<unknown> }} MountedList A mounted `ListScope`. */

// product.js has no types yet; these are the members of its scopes this module uses.
const scopes = /** @type {WeakMap<Element, RenderedProduct>} */ (untypedScopes);

/**
 * The marker on the `<script type="application/json">` tags `tether/server`'s `hydrate()` writes. It is fixed, not
 * `<prefix>-hydrate`, because the server writes it without knowing the browser's prefix.
 */
const HYDRATE_SELECTOR = 'script[type="application/json"][data-tether-hydrate]';

/** @type {WeakSet<Element>} */
export const mountedProducts = new WeakSet();
/** @type {WeakSet<Element>} */
export const mountedLists = new WeakSet();
/** @type {Set<HTMLElement>} Product roots to re-render after a country switch; pruned once disconnected. */
export const liveProducts = new Set();
/** @type {Set<MountedList>} Lists to reload after a country switch; pruned once disconnected. */
export const liveLists = new Set();
/** @type {WeakMap<Element, object>} Each product root's latest request, so a slow older response can't win. */
const latestRequest = new WeakMap();

/** Forgets roots a page transition removed, so they aren't kept alive. */
export function pruneLive() {
  liveProducts.forEach((el) => {
    if (!el.isConnected) liveProducts.delete(el);
  });
  liveLists.forEach((list) => {
    if (!list.root.isConnected) liveLists.delete(list);
  });
}

/**
 * @param {ParentNode & Partial<Pick<Element, 'matches'>>} root
 * @param {string} selector
 * @returns {HTMLElement[]} `root` itself when it matches, then the matches inside it.
 */
export function within(root, selector) {
  const self = root.matches?.(selector) ? [/** @type {HTMLElement} */ (root)] : [];
  return [...self, ...qsa(root, selector)];
}

/**
 * `tether-page-title="{title} | My shop"` on a product root sets `document.title`, for dynamic product pages.
 *
 * @param {Element} el
 * @param {Product} product
 */
function applyPageTitle(el, product) {
  const template = get(el, 'page-title');
  if (!template || typeof document === 'undefined') return;
  document.title = template
    .replace(/\{title\}/g, product.title)
    .replace(/\{vendor\}/g, product.vendor || '')
    .replace(/\{type\}/g, product.productType || '');
}

/**
 * A product root without a key: on a dynamic page opened without `?handle=` (or with an empty path) it is a product
 * that isn't there; inside a list it gets its handle when the list renders.
 *
 * @param {HTMLElement} el
 * @param {{ fromUrl: boolean, raw: string }} source
 */
function mountWithoutKey(el, { fromUrl, raw }) {
  if (fromUrl) {
    mountedProducts.add(el);
    setScopeStatus(el, 'not-found');
    emit('product-not-found', { key: null, source: raw }, el);
  } else if (!el.closest(listSelector())) {
    warn(`[${attr('product')}] without a value. Bind it to the Shopify handle field, or use "url:handle".`, el);
  }
}

/**
 * @param {HTMLElement} el
 * @param {string} key
 * @param {{ fromUrl: boolean, raw: string }} source
 * @param {unknown} error
 */
function showLoadFailure(el, key, { fromUrl, raw }, error) {
  const notFound = isNotFound(error);
  setScopeStatus(el, notFound ? 'not-found' : 'error', error);
  if (!notFound) {
    reportError(error, `product ${key}`);
    emit('error', { error, context: 'product', key }, el);
    return;
  }
  emit('product-not-found', { key, source: raw }, el);
  // A typo in a URL isn't worth an alert; a CMS item pointing at a deleted product is.
  if (fromUrl) log(`product not found: ${key}`);
  else reportError(error, `product ${key}`);
}

/**
 * Mounts one product root.
 *
 * @param {HTMLElement} el
 * @returns {boolean} True when a product request was started.
 */
export function mountProduct(el) {
  if (mountedProducts.has(el)) return false;
  const { key, ...source } = resolveProductKey(el);
  if (!key) {
    mountWithoutKey(el, source);
    return false;
  }
  mountedProducts.add(el);
  liveProducts.add(el);
  const request = {};
  latestRequest.set(el, request);
  const isLatest = () => latestRequest.get(el) === request;
  // A rendered scope keeps showing its content while it refreshes (a country switch).
  if (scopes.get(el)) el.setAttribute(attr('state'), 'updating');
  else setScopeStatus(el, 'loading');
  const loading = trackMarket(getProduct(key));
  loading
    .then((product) => {
      if (!isLatest()) return;
      const existing = scopes.get(el);
      if (existing) existing.update(product);
      else new ProductScope(el, product);
      applyPageTitle(el, product);
      if (cfg.revalidate && takeStale(key)) queueRefresh(key);
    })
    .catch((/** @type {unknown} */ error) => {
      if (isLatest()) showLoadFailure(el, key, source, error);
    });
  return true;
}

/** Loads again the product scopes that failed on a network or API error, for when the browser is back online. */
export function retryFailed() {
  pruneLive();
  liveProducts.forEach((el) => {
    if (el.getAttribute(attr('state')) !== 'error' || el.getAttribute(attr('error')) === 'not-found') return;
    mountedProducts.delete(el);
    mountProduct(el);
  });
}

/** @type {Set<string>} Server-rendered products to refresh in the next batch. */
let refreshQueue = new Set();

/** @param {string} key */
function queueRefresh(key) {
  if (!refreshQueue.size) setTimeout(flushRefresh, 0);
  refreshQueue.add(key);
}

/**
 * @param {string} key The key the refresh was asked for.
 * @param {Product} fresh
 */
function applyRefresh(key, fresh) {
  liveProducts.forEach((el) => {
    const scope = scopes.get(el);
    if (!scope || !el.isConnected) return;
    const rootKey = resolveProductKey(el).key;
    if (rootKey !== key && rootKey !== fresh.handle && rootKey !== fresh.id) return;
    if (JSON.stringify(scope.product) !== JSON.stringify(fresh)) scope.update(fresh);
  });
}

/** One batched background request refreshes every server-rendered product queued. */
function flushRefresh() {
  const keys = [...refreshQueue];
  refreshQueue = new Set();
  refreshProducts(keys).forEach((promise, index) => {
    const key = /** @type {string} */ (keys[index]);
    promise
      .then((fresh) => {
        applyRefresh(key, fresh);
      })
      .catch((/** @type {unknown} */ error) => {
        reportError(error, `refresh ${key}`);
      });
  });
}

/**
 * @type {Set<Promise<unknown>> | null} While the page's server-rendered prices are another market's: the loads to
 *   wait for before `html.tether-market-pending` goes. `null` when no market is pending.
 */
let marketPending = null;

/**
 * Lists, and anything else that loads prices, hold `html.tether-market-pending` until they are in.
 *
 * @template T
 * @param {Promise<T>} loading
 * @returns {Promise<T>} `loading` itself.
 */
export const trackMarket = (loading) => {
  marketPending?.add(loading);
  return loading;
};

/** After a mount: drops `html.tether-market-pending` once this page's products are live. */
export function settleMarket() {
  if (!marketPending) return;
  const waits = [...marketPending];
  void Promise.allSettled(waits).then(() => {
    if (!marketPending || waits.some((wait) => !marketPending?.has(wait))) return;
    if (waits.length !== marketPending.size) {
      settleMarket(); // more loads came in meanwhile
      return;
    }
    marketPending = null;
    document.documentElement.classList.remove(`${cfg.prefix}-market-pending`);
  });
}

/**
 * What `tether/server`'s `hydrate()` writes. The tag is the site's own markup, so its shape is trusted; a product
 * without an id or a handle is skipped.
 *
 * @typedef {{ country?: string | null, language?: string | null, products?: (Product | null)[] }} HydratePayload
 */

/**
 * @param {Product | null} product
 * @returns {product is Product}
 */
const isUsable = (product) => Boolean(product?.id && product.handle);

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
const sameCode = (a, b) => (a ?? '').toUpperCase() === (b ?? '').toUpperCase();

/** @type {WeakSet<Element>} Hydrate tags already read. */
const readScripts = new WeakSet();

/**
 * Uses the products in the page's hydrate tags (`tether/server` `hydrate()`) without a request. A tag made for another
 * market is skipped, and marks the page (`html.tether-market-pending`) until the live prices are in, so CSS can hide
 * prices meanwhile.
 *
 * @param {Document | Element} [root]
 */
export function hydrateFromPage(root = document) {
  qsa(root.ownerDocument ?? root, HYDRATE_SELECTOR).forEach((script) => {
    if (readScripts.has(script)) return;
    readScripts.add(script);
    /** @type {unknown} */
    let json;
    try {
      json = JSON.parse(script.textContent);
    } catch (error) {
      warn('bad data-tether-hydrate', error);
      return;
    }
    const { country, language, products } = /** @type {HydratePayload | null} */ (json) ?? {};
    const usable = Array.isArray(products) ? products.filter(isUsable) : [];
    rememberOptionNames(usable); // the build's option names, also for other languages
    if (sameCode(country, cfg.country) && sameCode(language, cfg.language)) {
      hydrateProducts(usable);
      return;
    }
    log('hydration skipped: other market');
    if (!marketPending) {
      marketPending = new Set();
      document.documentElement.classList.add(`${cfg.prefix}-market-pending`);
    }
  });
}
