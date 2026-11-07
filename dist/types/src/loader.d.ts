import { productKey } from './shopify-values.js';
import type { Product, Image } from './fragments.js';
import type { QueryText } from './client.js';
/** Accepts a handle, numeric id, gid or a full product URL. */
export declare const normalizeProductKey: typeof productKey;
/** Puts a product the page already has (from a collection query) in the cache, under its handle and its id. */
export declare function primeProduct(product: Product | null | undefined): void;
/**
 * @param rawKey A handle, numeric id, gid or product URL.
 * @throws {TetherError} `NOT_FOUND` (rejected) for an empty key or a product the store doesn't have.
 */
export declare function getProduct(rawKey: string | number | null | undefined): Promise<Product>;
/**
 * @param operation An operation that spreads `...TetherProduct`.
 * @returns The operation with the product fragment (which starts on its own line), written for what the token may
 *   read.
 */
export declare const withProductFragment: (operation: string) => QueryText;
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
