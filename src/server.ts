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
import { DEFAULTS, resolveConfig } from './config.ts';
import { request, withContext, TetherError } from './client.ts';
import * as plans from './selling-plans.ts';
import { imageUrl, formatPercent } from './dom.ts';
import { initialState } from './initial.ts';
import { STORE_ENV_NAMES, formatMoney, productKey, productUrl as productUrlFor } from './shopify-values.ts';
import { createCatalog } from './storefront/catalog.ts';
import { jsonLdData, scriptJson } from './storefront/json-ld.ts';
import type { TetherConfig, TetherOptions } from './config.ts';
import type { Product } from './fragments.ts';
import type { Money } from './shopify-values.ts';
import type { InitialOptions, InitialState } from './initial.ts';
import type { JsonLdOptions } from './storefront/json-ld.ts';

export { imageUrl, initialState, formatPercent, formatMoney, productKey };

export { TetherError, plans, withContext };

// The types a site uses by name, under the names the docs give them.
export type { StorefrontOptions, HydrateOptions };
export type { Money } from './shopify-values.ts';
export type { Product as ShopifyProduct, ProductVariant as ShopifyVariant } from './fragments.ts';
export type { ShopifyCart, ShopifyCartLine } from './cart/store.ts';
export type { Collection as ShopifyCollection, ProductQuery } from './loader.ts';
export type { InitialOptions, InitialState } from './initial.ts';
export type { ImageSize } from './images.ts';
export type { JsonLdOptions } from './storefront/json-ld.ts';
/** What `createStorefront()` returns. */
export type Storefront = ReturnType<typeof createStorefront>;

/** The options only a storefront has. */
interface ServerOptions {
  /** Replaces the global `fetch` (tests, caching). */
  fetch?: typeof fetch;
  /** Products per request for `allProducts()` (default 25). */
  pageSize?: number;
  /** The site's address, for product URLs in `jsonLd()` without `url`. */
  siteUrl?: string;
}

/**
 * The config options, or an `import.meta.env` spread into them: its `PUBLIC_SHOPIFY_*` names give the domain and
 * token, its other keys are ignored.
 */
type StorefrontOptions = TetherOptions & ServerOptions & StoreEnv;

/** The environment names that give the domain and the token. */
type StoreEnv = Partial<Record<(typeof STORE_ENV_NAMES)['domain' | 'token'][number], string>>;

type ServerConfig = TetherConfig & ServerOptions;

interface HydrateOptions {
  card?: boolean;
  images?: number;
}

const DEFAULT_PAGE_SIZE = 25;
/** The images a card keeps: the main one and a hover image (`tether-bind="image:2"`). */
const DEFAULT_CARD_IMAGES = 2;
/** The version of the `data-tether-hydrate` payload, for the browser script reading it. */
const HYDRATE_VERSION = 1;

/**
 * @returns `productPath` `/products` → `/products/<handle>`; templates with `{handle}` and `{id}` work too. `null` when
 *   the path needs a handle or an id that is empty.
 */
export function productUrl(
  handle: string,
  { productPath = DEFAULTS.productPath, id }: { productPath?: string; id?: string } = {},
): string | null {
  return productUrlFor(productPath, handle, id);
}

/** @returns The first of the `names` set in `options`, `''` without one. */
function fromEnv(options: StoreEnv, names: readonly (keyof StoreEnv)[]): string {
  for (const name of names) {
    const value = options[name];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/**
 * @returns The config options of `options`, resolved and validated as the browser's are, with the domain and token
 *   from the environment names when they aren't set.
 */
function storefrontConfig(options: StorefrontOptions): ServerConfig {
  const known: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (key in DEFAULTS) known[key] = value;
  }
  const domain = typeof options.domain === 'string' && options.domain ? options.domain : '';
  const token = typeof options.token === 'string' && options.token ? options.token : '';
  const conf: ServerConfig = resolveConfig({
    // Only config keys, each parsed by `resolveConfig`.
    ...known,
    domain: domain || fromEnv(options, STORE_ENV_NAMES.domain),
    token: token || fromEnv(options, STORE_ENV_NAMES.token),
  });
  if (options.fetch) conf.fetch = options.fetch;
  if (options.pageSize !== undefined) conf.pageSize = options.pageSize;
  if (options.siteUrl !== undefined) conf.siteUrl = options.siteUrl;
  return conf;
}

/** @returns `pageSize` when it is a positive integer, else the default. */
const validPageSize = (pageSize: number | undefined): number =>
  typeof pageSize === 'number' && Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;

/**
 * A product for a list (home, collections, recommendations): without descriptions and variant images, and only its
 * first `images` images. Prices, stock and plans per variant stay.
 */
function cardOf(product: Product, images: number): Product {
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
 * @throws {TetherError} `NOT_CONFIGURED` without a domain and a token.
 */
export function createStorefront(options: StorefrontOptions = {}) {
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
   * @param options `card: true` for lists: about 40% smaller (see `cardOf`). The full product comes with the
   *   background refresh.
   */
  function hydrate(
    products: Product | null | undefined | (Product | null | undefined)[],
    { card = false, images = DEFAULT_CARD_IMAGES }: HydrateOptions = {},
  ): string {
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

  /** @returns The `<script type="application/ld+json">` tag, `''` without a product. */
  function jsonLd(product: Product | null | undefined, jsonLdOptions: JsonLdOptions = {}): string {
    if (!product) return '';
    return `<script type="application/ld+json">${scriptJson(jsonLdData(product, jsonLdOptions, site))}</script>`;
  }

  /** `initialState()` with the storefront's `defaultPurchase` and `lowStock`. */
  function storefrontInitialState(product: Product, initialOptions?: InitialOptions): InitialState;
  function storefrontInitialState(
    product: Product | null | undefined,
    initialOptions?: InitialOptions,
  ): InitialState | null;
  function storefrontInitialState(
    product: Product | null | undefined,
    initialOptions: InitialOptions = {},
  ): InitialState | null {
    return initialState(product, { defaultPurchase: conf.defaultPurchase, lowStock: conf.lowStock, ...initialOptions });
  }

  return {
    config: conf,
    query: <T>(query: string, variables?: Record<string, unknown>, requestOptions?: { context?: boolean }) =>
      request<T>(conf, query, variables, requestOptions),
    ...catalog,
    hydrate,
    formatMoney: (money: Money | null | undefined, locale: string | undefined = conf.locale) =>
      formatMoney(money, locale),
    formatPercent: (percentage: number, locale: string | undefined = conf.locale) => formatPercent(percentage, locale),
    imageUrl,
    jsonLd,
    jsonLdData: (product: Product | null | undefined, jsonLdOptions: JsonLdOptions = {}) =>
      jsonLdData(product, jsonLdOptions, site),
    initialState: storefrontInitialState,
    productUrl: (handle: string, urlOptions: { productPath?: string; id?: string } = {}) =>
      productUrl(handle, { productPath: conf.productPath, ...urlOptions }),
    plans,
  };
}
