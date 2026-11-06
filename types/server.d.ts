import type { ShopifyProduct, ShopifyVariant, Money, TetherError, SellingPlanHelpers, TetherConfig } from './index.js';
export type { ShopifyProduct, ShopifyVariant, ShopifyCart, ShopifyCartLine, Money } from './index.js';

export interface StorefrontOptions extends Partial<
  Pick<
    TetherConfig,
    | 'apiVersion'
    | 'country'
    | 'language'
    | 'locale'
    | 'productPath'
    | 'maxAge'
    | 'lowStock'
    | 'defaultPurchase'
    | 'metafields'
    | 'imagesFirst'
    | 'variantsFirst'
    | 'sellingPlanGroupsFirst'
    | 'sellingPlansFirst'
    | 'retries'
  >
> {
  /** your-store.myshopify.com (or pass import.meta.env with PUBLIC_SHOPIFY_DOMAIN). */
  domain?: string;
  /** Public Storefront API token (or PUBLIC_SHOPIFY_STOREFRONT_TOKEN in import.meta.env). */
  token?: string;
  /** Your site's address, e.g. https://shop.example: product URLs in jsonLd() without passing url. */
  siteUrl?: string;
  /** Products per request for allProducts() (default 25). */
  pageSize?: number;
  /** Custom fetch (tests, caching). */
  fetch?: typeof fetch;
  PUBLIC_SHOPIFY_DOMAIN?: string;
  PUBLIC_SHOPIFY_STOREFRONT_TOKEN?: string;
  /** Astro's import.meta.env carries these too; ignored. */
  MODE?: string;
  BASE_URL?: string;
  PROD?: boolean;
  DEV?: boolean;
  SSR?: boolean;
  SITE?: string;
  ASSETS_PREFIX?: string;
}

export interface ShopifyCollection {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  image?: { url: string; altText?: string | null } | null;
  seo?: { title?: string | null; description?: string | null };
}

export interface ProductQuery {
  collection?: string;
  /** A Shopify search query; null or '' = every product (e.g. searchParams.get('q')). */
  query?: string | null;
  first?: number;
  after?: string | null;
  sortKey?: string;
  reverse?: boolean;
  filters?: unknown[];
}

export interface Storefront {
  readonly config: Required<Pick<StorefrontOptions, 'domain' | 'token'>> & StorefrontOptions;
  query<T = any>(query: string, variables?: Record<string, unknown>, opts?: { context?: boolean }): Promise<T>;
  /** By handle, numeric id, gid or product URL. null when it doesn't exist. */
  getProduct(handleOrId: string | number | null | undefined): Promise<ShopifyProduct | null>;
  getProducts(opts?: ProductQuery): Promise<{
    collection: ShopifyCollection | null;
    products: ShopifyProduct[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  }>;
  /** Every product (of a collection or a search query), page by page. For getStaticPaths(). */
  allProducts(opts?: Omit<ProductQuery, 'first' | 'after'>): Promise<ShopifyProduct[]>;
  getCollection(
    handle: string,
    opts?: Omit<ProductQuery, 'collection'>,
  ): Promise<
    | (ShopifyCollection & { products: ShopifyProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } })
    | null
  >;
  allCollections(): Promise<ShopifyCollection[]>;
  /** By handle, id or product (runs in parallel with getProduct when you pass the handle). */
  getRecommendations(
    product: string | number | Pick<ShopifyProduct, 'id'> | null | undefined,
    intent?: 'RELATED' | 'COMPLEMENTARY',
  ): Promise<ShopifyProduct[]>;
  /**
   * A <script type="application/json" data-tether-hydrate> tag: the browser script renders these
   * products without its own request, then refreshes prices and stock once in the background.
   * Astro: <Fragment set:html={shop.hydrate(product)} />
   */
  hydrate(
    products: ShopifyProduct | null | undefined | (ShopifyProduct | null | undefined)[],
    opts?: {
      /** For lists: without descriptions and variant images, about 40% smaller. */
      card?: boolean;
      /** Images a card keeps (default 2: the main one and a hover image). */
      images?: number;
    },
  ): string;
  formatMoney(money: Money | null | undefined, locale?: string): string;
  /** 30 -> '30%' (nl, en) / '30 %' (de, fr), the way Tether shows savings. '' for 0. */
  formatPercent(n: number | null | undefined, locale?: string): string;
  /** null when the path needs a handle or an id that is empty. */
  productUrl(handle: string, opts?: { productPath?: string; id?: string }): string | null;
  /** Shopify CDN image at a size. Use the element's max-width value, so the browser keeps the image. */
  imageUrl(url: string | null | undefined, size?: ImageSize): string;
  /**
   * What Tether shows first for this product (variant, price, purchase mode, tether-show conditions),
   * so the server renders the same and nothing flashes. Pass Astro.url.searchParams.get('variant') in SSR.
   */
  initialState(product: ShopifyProduct, opts?: InitialOptions): InitialState;
  initialState(product: ShopifyProduct | null | undefined, opts?: InitialOptions): InitialState | null;
  /** schema.org Product / ProductGroup data for search engines, as a <script type="application/ld+json"> tag. */
  jsonLd(product: ShopifyProduct | null | undefined, opts?: { url?: string; brand?: string }): string;
  jsonLdData(
    product: ShopifyProduct | null | undefined,
    opts?: { url?: string; brand?: string },
  ): Record<string, unknown> | null;
  plans: SellingPlanHelpers;
}

export interface InitialState {
  variant: ShopifyVariant;
  /** option name -> value of that variant: is-selected on those buttons. */
  selected: Record<string, string>;
  purchase: 'one-time' | 'subscription';
  plan: { id: string; name: string } | null;
  plans: { id: string; name: string; price: Money; savings: number; selected: boolean; available: boolean }[];
  savings: number;
  /** The price Tether shows first (the plan price for products that require a subscription). */
  price: Money;
  /** Set only when on sale. */
  compareAtPrice: Money | null;
  available: boolean;
  /** tether-show conditions: hidden={!state.show['out-of-stock']}. */
  show: Record<
    | 'in-stock'
    | 'out-of-stock'
    | 'backorder'
    | 'on-sale'
    | 'not-on-sale'
    | 'has-variants'
    | 'single-variant'
    | 'low-stock'
    | 'subscription-available'
    | 'subscription-unavailable'
    | 'subscription-only'
    | 'one-time-available'
    | 'subscription-selected'
    | 'one-time-selected'
    | 'plenty-in-stock'
    | 'has-savings',
    boolean
  >;
  /** true for option values without an available variant: class is-unavailable. */
  isUnavailable(optionName: string, value: string): boolean;
}
export interface InitialOptions {
  variant?: string | null;
  sellingPlan?: string | null;
  defaultPurchase?: 'one-time' | 'subscription';
  /** low-stock at this many or fewer (default 5). */
  lowStock?: number;
}
export declare function initialState(product: ShopifyProduct, opts?: InitialOptions): InitialState;
export declare function initialState(
  product: ShopifyProduct | null | undefined,
  opts?: InitialOptions,
): InitialState | null;

export interface ImageSize {
  width?: number;
  height?: number;
  crop?: 'center' | 'top' | 'bottom' | 'left' | 'right';
}
export declare function imageUrl(url: string | null | undefined, size?: ImageSize): string;
export declare function createStorefront(options?: StorefrontOptions): Storefront;
export declare function formatMoney(money: Money | null | undefined, locale?: string): string;
export declare function formatPercent(n: number | null | undefined, locale?: string): string;
/** null when the path needs a handle or an id that is empty. */
export declare function productUrl(handle: string, opts?: { productPath?: string; id?: string }): string | null;
export declare function productKey(raw: string | number | null | undefined): string | null;
export declare function withContext(query: string, ctx?: { country?: string; language?: string }): string;
export declare const plans: SellingPlanHelpers;
export { TetherError };
