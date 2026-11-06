import { withContext, TetherError } from './client.js';
import * as plans from './selling-plans.js';
import { imageUrl, formatPercent } from './dom.js';
import { initialState } from './initial.js';
import { STORE_ENV_NAMES, formatMoney, productKey } from './shopify-values.js';
import type { TetherConfig, TetherOptions } from './config.js';
import type { Product } from './fragments.js';
import type { Money } from './shopify-values.js';
import type { InitialOptions, InitialState } from './initial.js';
import type { JsonLdOptions } from './storefront/json-ld.js';
export { imageUrl, initialState, formatPercent, formatMoney, productKey };
export { TetherError, plans, withContext };
export type { StorefrontOptions, HydrateOptions };
export type { Money } from './shopify-values.js';
export type { Product as ShopifyProduct, ProductVariant as ShopifyVariant } from './fragments.js';
export type { ShopifyCart, ShopifyCartLine } from './cart/store.js';
export type { Collection as ShopifyCollection, ProductQuery } from './loader.js';
export type { InitialOptions, InitialState } from './initial.js';
export type { ImageSize } from './images.js';
export type { JsonLdOptions } from './storefront/json-ld.js';
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
/**
 * @returns `productPath` `/products` → `/products/<handle>`; templates with `{handle}` and `{id}` work too. `null` when
 *   the path needs a handle or an id that is empty.
 */
export declare function productUrl(handle: string, { productPath, id }?: {
    productPath?: string;
    id?: string;
}): string | null;
/**
 * A storefront: the store's products and collections for the server, and the tags that hand them to the page.
 *
 * @throws {TetherError} `NOT_CONFIGURED` without a domain and a token.
 */
export declare function createStorefront(options?: StorefrontOptions): {
    hydrate: (products: Product | null | undefined | (Product | null | undefined)[], { card, images }?: HydrateOptions) => string;
    formatMoney: (money: Money | null | undefined, locale?: string | undefined) => string;
    formatPercent: (percentage: number, locale?: string | undefined) => string;
    imageUrl: typeof imageUrl;
    jsonLd: (product: Product | null | undefined, jsonLdOptions?: JsonLdOptions) => string;
    jsonLdData: (product: Product | null | undefined, jsonLdOptions?: JsonLdOptions) => Record<string, unknown> | null;
    initialState: {
        (product: Product, initialOptions?: InitialOptions): InitialState;
        (product: Product | null | undefined, initialOptions?: InitialOptions): InitialState | null;
    };
    productUrl: (handle: string, urlOptions?: {
        productPath?: string;
        id?: string;
    }) => string | null;
    plans: typeof plans;
    getProduct: (raw: string | number | null | undefined) => Promise<Product | null>;
    getProducts: (options?: import("./storefront/catalog.js").CatalogQuery) => Promise<import("./loader.js").ProductPage>;
    allProducts: (options?: Omit<import("./storefront/catalog.js").CatalogQuery, "first" | "after">) => Promise<Product[]>;
    getCollection: (handle: string, options?: Omit<import("./storefront/catalog.js").CatalogQuery, "collection">) => Promise<(import("./loader.js").Collection & {
        products: Product[];
        pageInfo: import("./loader.js").PageInfo;
    }) | null>;
    allCollections: () => Promise<import("./loader.js").Collection[]>;
    getRecommendations: (product: string | number | {
        id: string;
    } | null | undefined, intent?: "RELATED" | "COMPLEMENTARY") => Promise<Product[]>;
    config: ServerConfig;
    query: <T>(query: string, variables?: Record<string, unknown>, requestOptions?: {
        context?: boolean;
    }) => Promise<T>;
};
