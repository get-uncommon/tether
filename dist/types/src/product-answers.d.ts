import type { Product } from './fragments.js';
import type { Collection, PageInfo } from './loader.js';
/** A page of a GraphQL connection of products. */
interface ProductConnection {
    nodes: Product[];
    pageInfo: PageInfo;
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
export {};
