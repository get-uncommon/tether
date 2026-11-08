import type { Money } from './shopify-values.js';
interface SearchImage {
    url: string;
    altText: string | null;
}
interface SearchProduct {
    id: string;
    handle: string;
    title: string;
    availableForSale: boolean;
    featuredImage: SearchImage | null;
    priceRange: {
        minVariantPrice: Money;
    };
}
interface SearchCollection {
    handle: string;
    title: string;
    image: SearchImage | null;
}
interface SearchQuery {
    text: string;
}
export interface SearchResults {
    products: SearchProduct[];
    collections: SearchCollection[];
    queries: SearchQuery[];
}
/**
 * Sets up every `[tether-search]` in `root` (and `root` itself) once, and stops the boxes no longer on the page.
 */
export declare function mountSearch(root?: ParentNode & Partial<Pick<Element, 'matches'>>): void;
export {};
