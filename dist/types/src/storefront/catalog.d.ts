import type { StorefrontConfig } from '../client.js';
import type { ProductFragmentConfig, Product } from '../fragments.js';
import type { ProductRef, RecommendationIntent } from '../shopify-values.js';
import type { Collection, PageInfo, ProductPage } from '../loader.js';
/** What the catalog needs of a storefront's config. */
type CatalogConfig = StorefrontConfig & ProductFragmentConfig;
/** A page of a collection's products, or of a search. */
export interface CatalogQuery {
    /** A collection handle; without one, a search. */
    collection?: string;
    /** Storefront search syntax; `null` or `''` is every product. */
    query?: string | null;
    /** Default the storefront's `pageSize`. */
    first?: number;
    /** The cursor of the page before. */
    after?: string | null;
    /** `ProductCollectionSortKeys` for a collection, `ProductSortKeys` for a search. */
    sortKey?: string;
    reverse?: boolean;
    /** `ProductFilter` values, for a collection. */
    filters?: unknown[];
}
type CollectionWithProducts = Collection & {
    products: Product[];
    pageInfo: PageInfo;
};
/** @param pageSize Products per page when a query doesn't say. */
export declare function createCatalog(conf: CatalogConfig, pageSize: number): {
    getProduct: (raw: string | number | null | undefined) => Promise<Product | null>;
    getProducts: (options?: CatalogQuery) => Promise<ProductPage>;
    allProducts: (options?: Omit<CatalogQuery, "first" | "after">) => Promise<Product[]>;
    getCollection: (handle: string, options?: Omit<CatalogQuery, "collection">) => Promise<CollectionWithProducts | null>;
    allCollections: () => Promise<Collection[]>;
    getRecommendations: (product: ProductRef | null | undefined, intent?: RecommendationIntent) => Promise<Product[]>;
};
export {};
