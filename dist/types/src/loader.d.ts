import { productKey } from './shopify-values.js';
import type { Product, Image } from './fragments.js';
import type { ProductConnection } from './product-shape.js';
/** Accepts a handle, numeric id, gid or a full product URL. */
export declare const normalizeProductKey: typeof productKey;
/** Puts a product the page already has (from a collection query) in the cache, under its handle and its id. */
export declare function primeProduct(product: Product | null | undefined): void;
/**
 * @param rawKey A handle, numeric id, gid or product URL.
 * @throws {TetherError} `NOT_FOUND` (rejected) for an empty key or a product the store doesn't have.
 */
export declare function getProduct(rawKey: string | number | null | undefined): Promise<Product>;
/** Forgets every product, for a new market: requests already sent no longer fill the cache. */
export declare function clearProductCache(): void;
/**
 * Uses products the server rendered, unless the page loaded the same product live in the last `FRESH_MS` (an earlier
 * page of a View Transition visit), whose copy is newer.
 */
export declare function hydrateProducts(products: readonly Product[] | null | undefined): void;
/** @returns True once per server-rendered product: the caller then refreshes it. */
export declare function takeStale(rawKey: string | number | null | undefined): boolean;
/** Loads this product again, past the cache. Products refreshed in the same tick go out as one request. */
export declare function refreshProduct(key: string | number): Promise<Product>;
export interface PageInfo {
    hasNextPage: boolean;
    endCursor: string | null;
}
export interface Collection {
    id: string;
    handle: string;
    title: string;
    description: string;
    descriptionHtml: string;
    image: Image | null;
    seo: {
        title: string | null;
        description: string | null;
    };
}
export interface ProductPage {
    collection: Collection | null;
    products: Product[];
    pageInfo: PageInfo;
}
export interface ProductQuery {
    /** A collection handle; without one, a search. */
    collection?: string;
    /** Storefront search syntax, for a search. */
    query?: string;
    first?: number;
    /** The cursor of the page before. */
    after?: string | null;
    /** `ProductCollectionSortKeys` for a collection, `ProductSortKeys` for a search. */
    sortKey?: string;
    reverse?: boolean;
    /** `ProductFilter` values, for a collection. */
    filters?: unknown[];
}
/** A collection's answer: `null` for a handle the store doesn't have. Its other fields are written as text. */
export declare const isCollectionAnswer: import("./client.js").DataCheck<{
    collection: (Collection & {
        products: ProductConnection;
    }) | null;
}>;
export declare const isSearchAnswer: import("./client.js").DataCheck<{
    products: ProductConnection;
}>;
export declare const isRecommendationsAnswer: import("./client.js").DataCheck<{
    productRecommendations: Product[] | null;
}>;
/**
 * A page of products from a collection (by handle) or from a search. Every product on it is cached.
 *
 * @throws {TetherError} `NOT_FOUND` for a collection the store doesn't have.
 */
export declare function getProducts({ collection, query, first, after, sortKey, reverse, filters, }?: ProductQuery): Promise<ProductPage>;
/**
 * Shopify's recommendations for a product. Every product in them is cached.
 *
 * @param product A product, or its handle, id or gid.
 */
export declare function getRecommendations(product: string | number | {
    id: string;
} | null | undefined, intent?: 'RELATED' | 'COMPLEMENTARY'): Promise<Product[]>;
