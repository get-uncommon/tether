/**
 * `@occluze/tether/server`: Shopify product data at build time or on the server (Astro, Eleventy, Node, Cloudflare
 * Workers). No browser APIs. It sends the browser script's own queries, so products handed over with `hydrate()` are
 * exactly what the script expects and need no request of their own.
 *
 *   import { createStorefront } from '@occluze/tether/server';
 *   const shop = createStorefront({ domain, token, country: 'NL' });
 *   const product = await shop.getProduct('coffee-box');
 *   const all = await shop.allProducts();
 */
import { DEFAULTS, resolveConfig } from './config.js';
import { request, withContext, TetherError } from './client.js';
import * as plans from './selling-plans.js';
import { imageUrl, formatPercent } from './dom.js';
import { initialState } from './initial.js';
import { STORE_ENV_NAMES, formatMoney, productKey, productUrl as productUrlFor } from './shopify-values.js';
import { createCatalog } from './storefront/catalog.js';
import { jsonLdData, scriptJson } from './storefront/json-ld.js';
/** @import { TetherConfig, TetherOptions } from './config.js' */
/** @import { Product } from './fragments.js' */
/** @import { Money } from './shopify-values.js' */
/** @import { InitialOptions } from './initial.js' */
/** @import { JsonLdOptions } from './storefront/json-ld.js' */

export { imageUrl, initialState, formatPercent, formatMoney, productKey };

export { TetherError, plans, withContext };

/**
 * @typedef {object} ServerOptions The options only a storefront has.
 * @property {typeof fetch} [fetch] Replaces the global `fetch` (tests, caching).
 * @property {number} [pageSize] Products per request for `allProducts()` (default 25).
 * @property {string} [siteUrl] The site's address, for product URLs in `jsonLd()` without `url`.
 */

/**
 * @typedef {TetherOptions & ServerOptions & Record<string, unknown>} StorefrontOptions The config options, or an
 *   `import.meta.env` spread into them: its `PUBLIC_SHOPIFY_*` names give the domain and token, its other keys are
 *   ignored.
 */

/** @typedef {TetherConfig & ServerOptions} ServerConfig */

/** @typedef {{ card?: boolean, images?: number }} HydrateOptions */

const DEFAULT_PAGE_SIZE = 25;
/** The images a card keeps: the main one and a hover image (`tether-bind="image:2"`). */
const DEFAULT_CARD_IMAGES = 2;
/** The version of the `data-tether-hydrate` payload, for the browser script reading it. */
const HYDRATE_VERSION = 1;

/**
 * @param {string} handle
 * @param {{ productPath?: string, id?: string }} [options]
 * @returns {string} `productPath` `/products` → `/products/<handle>`; templates with `{handle}` and `{id}` work too.
 */
export function productUrl(handle, { productPath = DEFAULTS.productPath, id } = {}) {
  return productUrlFor(productPath, handle, id);
}

/**
 * @param {Record<string, unknown>} options
 * @param {readonly string[]} names
 * @returns {string} The first of the `names` set in `options`, `''` without one.
 */
function fromEnv(options, names) {
  for (const name of names) {
    const value = options[name];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/**
 * @param {StorefrontOptions} options
 * @returns {ServerConfig} The config options of `options`, resolved and validated as the browser's are, with the
 *   domain and token from the environment names when they aren't set.
 */
function storefrontConfig(options) {
  /** @type {Record<string, unknown>} */
  const known = {};
  for (const [key, value] of Object.entries(options)) {
    if (key in DEFAULTS) known[key] = value;
  }
  const domain = typeof options.domain === 'string' && options.domain ? options.domain : '';
  const token = typeof options.token === 'string' && options.token ? options.token : '';
  /** @type {ServerConfig} */
  const conf = resolveConfig({
    // Only config keys: `resolveConfig` checks each value.
    .../** @type {TetherOptions} */ (known),
    domain: domain || fromEnv(options, STORE_ENV_NAMES.domain),
    token: token || fromEnv(options, STORE_ENV_NAMES.token),
  });
  if (options.fetch) conf.fetch = options.fetch;
  if (options.pageSize !== undefined) conf.pageSize = options.pageSize;
  if (options.siteUrl !== undefined) conf.siteUrl = options.siteUrl;
  return conf;
}

/**
 * @param {number | undefined} pageSize
 * @returns {number} `pageSize` when it is a positive integer, else the default.
 */
const validPageSize = (pageSize) =>
  typeof pageSize === 'number' && Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;

/**
 * A product for a list (home, collections, recommendations): without descriptions and variant images, and only its
 * first `images` images. Prices, stock and plans per variant stay.
 *
 * @param {Product} product
 * @param {number} images
 * @returns {Product}
 */
function cardOf(product, images) {
  return {
    ...product,
    description: '',
    descriptionHtml: '',
    images: { nodes: product.images.nodes.slice(0, Math.max(1, images)) },
    variants: { nodes: product.variants.nodes.map((variant) => ({ ...variant, image: null })) },
  };
}

/**
 * A storefront: the store's products and collections for the server, and the tags that hand them to the page.
 *
 * @param {StorefrontOptions} [options]
 * @throws {TetherError} `NOT_CONFIGURED` without a domain and a token.
 */
export function createStorefront(options = {}) {
  const conf = storefrontConfig(options);
  if (!conf.domain || !conf.token) {
    throw new TetherError(
      'createStorefront needs domain and token: pass them, or import.meta.env with PUBLIC_SHOPIFY_DOMAIN and PUBLIC_SHOPIFY_STOREFRONT_TOKEN',
      { code: 'NOT_CONFIGURED' },
    );
  }
  const catalog = createCatalog(conf, validPageSize(conf.pageSize));
  const site = { productPath: conf.productPath, siteUrl: conf.siteUrl };

  /**
   * A `<script type="application/json" data-tether-hydrate>` tag that hands products to the browser script: it renders
   * them at once, without a request of its own, then refreshes prices and stock once in the background. Astro:
   * `<Fragment set:html={shop.hydrate(products)} />`.
   *
   * @param {Product | null | undefined | (Product | null | undefined)[]} products
   * @param {HydrateOptions} [options] `card: true` for lists: about 40% smaller (see `cardOf`). The full product
   *   comes with the background refresh.
   */
  function hydrate(products, { card = false, images = DEFAULT_CARD_IMAGES } = {}) {
    const present = (Array.isArray(products) ? products : [products]).filter((product) => product != null);
    const payload = {
      v: HYDRATE_VERSION,
      at: new Date().toISOString(),
      country: conf.country || null,
      language: conf.language || null,
      products: card ? present.map((product) => cardOf(product, images)) : present,
    };
    return `<script type="application/json" data-tether-hydrate>${scriptJson(payload)}</script>`;
  }

  /**
   * @param {Product | null | undefined} product
   * @param {JsonLdOptions} [jsonLdOptions]
   * @returns {string} The `<script type="application/ld+json">` tag, `''` without a product.
   */
  function jsonLd(product, jsonLdOptions = {}) {
    if (!product) return '';
    return `<script type="application/ld+json">${scriptJson(jsonLdData(product, jsonLdOptions, site))}</script>`;
  }

  return {
    config: conf,
    /**
     * @template T
     * @param {string} query
     * @param {Record<string, unknown>} [variables]
     * @param {{ context?: boolean }} [requestOptions]
     * @returns {Promise<T>}
     */
    query: (query, variables, requestOptions) => request(conf, query, variables, requestOptions),
    ...catalog,
    hydrate,
    /**
     * @param {Money | null | undefined} money
     * @param {string | undefined} [locale]
     */
    formatMoney: (money, locale = conf.locale) => formatMoney(money, locale),
    /**
     * @param {number} percentage
     * @param {string | undefined} [locale]
     */
    formatPercent: (percentage, locale = conf.locale) => formatPercent(percentage, locale),
    imageUrl,
    jsonLd,
    /**
     * @param {Product | null | undefined} product
     * @param {JsonLdOptions} [jsonLdOptions]
     */
    jsonLdData: (product, jsonLdOptions = {}) => jsonLdData(product, jsonLdOptions, site),
    /**
     * @param {Product | null | undefined} product
     * @param {InitialOptions} [initialOptions]
     */
    initialState: (product, initialOptions = {}) =>
      initialState(product, { defaultPurchase: conf.defaultPurchase, lowStock: conf.lowStock, ...initialOptions }),
    /**
     * @param {string} handle
     * @param {{ productPath?: string, id?: string }} [urlOptions]
     */
    productUrl: (handle, urlOptions = {}) => productUrl(handle, { productPath: conf.productPath, ...urlOptions }),
    plans,
  };
}
