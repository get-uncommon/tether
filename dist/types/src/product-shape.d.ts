import type { Product } from './fragments.js';
import type { PageInfo } from './loader.js';
/** A page of a GraphQL connection of products. */
export interface ProductConnection {
    nodes: Product[];
    pageInfo: PageInfo;
}
/** A Storefront API `MoneyV2`. */
export declare const MONEY: {
    readonly amount: "string";
    readonly currencyCode: "string";
};
/**
 * A product's id, handle and title, and every list and price a render walks without a fallback: images, options,
 * variants (each with an id, a price and its options) and the price range. Text fields are written as text, and the
 * selling plan lists are read with a fallback, so they need no check.
 */
export declare const PRODUCT: {
    readonly id: "string";
    readonly handle: "string";
    readonly title: "string";
    readonly options: readonly ["object"];
    readonly images: {
        readonly nodes: readonly ["object"];
    };
    readonly priceRange: {
        readonly minVariantPrice: {
            readonly amount: "string";
            readonly currencyCode: "string";
        };
        readonly maxVariantPrice: {
            readonly amount: "string";
            readonly currencyCode: "string";
        };
    };
    readonly variants: {
        readonly nodes: readonly [{
            readonly id: "string";
            readonly price: {
                readonly amount: "string";
                readonly currencyCode: "string";
            };
            readonly selectedOptions: readonly ["object"];
        }];
    };
};
/** A page of products, with the `pageInfo` paging reads. */
export declare const PRODUCT_CONNECTION: {
    readonly nodes: readonly [{
        readonly id: "string";
        readonly handle: "string";
        readonly title: "string";
        readonly options: readonly ["object"];
        readonly images: {
            readonly nodes: readonly ["object"];
        };
        readonly priceRange: {
            readonly minVariantPrice: {
                readonly amount: "string";
                readonly currencyCode: "string";
            };
            readonly maxVariantPrice: {
                readonly amount: "string";
                readonly currencyCode: "string";
            };
        };
        readonly variants: {
            readonly nodes: readonly [{
                readonly id: "string";
                readonly price: {
                    readonly amount: "string";
                    readonly currencyCode: "string";
                };
                readonly selectedOptions: readonly ["object"];
            }];
        };
    }];
    readonly pageInfo: {
        readonly hasNextPage: "boolean";
    };
};
/** True for a value with the structure of `PRODUCT` and a non-empty id and handle. */
export declare const isProductShape: (value: unknown) => value is Product;
/**
 * A node a lookup by gid answers: a product, or a node of another type, for which `... on Product` selects no field
 * (no `id`).
 */
export declare const PRODUCT_NODE: (node: unknown) => boolean;
