import type { Product } from './fragments.js';
import type { ProductRef, RecommendationIntent } from './shopify-values.js';
import type { ProductPage, ProductQuery } from './loader.js';
/**
 * A page of products from a collection (by handle) or from a search. Every product on it is cached.
 *
 * @throws {TetherError} `NOT_FOUND` for a collection the store doesn't have.
 */
export declare function getProducts({ collection, query, first, after, sortKey, reverse, filters, }?: ProductQuery): Promise<ProductPage>;
/**
 * Shopify's recommendations for a product. Every product in them is cached.
 *
 * @throws {TetherError} `NOT_FOUND` when `product` names no product (empty, `null` or `undefined`).
 */
export declare function getRecommendations(product: ProductRef | null | undefined, intent?: RecommendationIntent): Promise<Product[]>;
/**
 * Loads the products of the list at `root` and renders them, replacing what it shows. Never rejects: a failure shows
 * in the list's state and is reported.
 */
export declare function loadList(root: HTMLElement): Promise<void>;
