import type { TetherConfig } from './config.js';
import type { Money } from './shopify-values.js';
import type { StoreAccess } from './client.js';
export interface Image {
    url: string;
    altText: string | null;
    width: number | null;
    height: number | null;
}
/** An option value's swatch: a colour, an image, or both, as the merchant set them in the admin. */
interface Swatch {
    color: string | null;
    image: {
        previewImage: Image | null;
    } | null;
}
export type SellingPlanAdjustmentValue = {
    __typename: 'SellingPlanPercentagePriceAdjustment';
    adjustmentPercentage: number;
} | {
    __typename: 'SellingPlanFixedAmountPriceAdjustment';
    adjustmentAmount: Money;
} | {
    __typename: 'SellingPlanFixedPriceAdjustment';
    price: Money;
};
export interface SellingPlan {
    id: string;
    name: string;
    description: string | null;
    recurringDeliveries: boolean;
    options: {
        name: string;
        value: string;
    }[];
    priceAdjustments: {
        orderCount: number | null;
        adjustmentValue: SellingPlanAdjustmentValue;
    }[];
}
export interface SellingPlanGroup {
    name: string;
    appName: string | null;
    options: {
        name: string;
        values: string[];
    }[];
    sellingPlans: {
        nodes: SellingPlan[];
    };
}
/** A variant's price on one plan. */
export interface SellingPlanAllocation {
    sellingPlan: {
        id: string;
    };
    /** What the customer pays at checkout (more for a prepaid plan). */
    checkoutChargeAmount: Money;
    remainingBalanceChargeAmount: Money;
    priceAdjustments: {
        price: Money;
        compareAtPrice: Money;
        perDeliveryPrice: Money;
        unitPrice: Money | null;
    }[];
}
export interface ProductVariant {
    id: string;
    title: string;
    availableForSale: boolean;
    currentlyNotInStock: boolean;
    /** Absent when the store's token can't read inventory. */
    quantityAvailable?: number | null;
    sku: string | null;
    barcode: string | null;
    selectedOptions: {
        name: string;
        value: string;
    }[];
    image: Image | null;
    price: Money;
    compareAtPrice: Money | null;
    unitPrice: Money | null;
    sellingPlanAllocations: {
        nodes: SellingPlanAllocation[];
    };
}
export interface Metafield {
    namespace: string;
    key: string;
    type: string;
    value: string;
    /** A file reference's image. */
    reference: {
        image?: Image;
    } | null;
}
/** The fields of `fragment TetherProduct`. */
export interface Product {
    id: string;
    handle: string;
    title: string;
    description: string;
    descriptionHtml: string;
    productType: string;
    vendor: string;
    tags: string[];
    availableForSale: boolean;
    publishedAt: string | null;
    onlineStoreUrl: string | null;
    requiresSellingPlan: boolean;
    seo: {
        title: string | null;
        description: string | null;
    };
    featuredImage: Image | null;
    images: {
        nodes: Image[];
    };
    options: {
        name: string;
        optionValues: {
            name: string;
            swatch: Swatch | null;
        }[];
    }[];
    priceRange: {
        minVariantPrice: Money;
        maxVariantPrice: Money;
    };
    compareAtPriceRange: {
        minVariantPrice: Money;
        maxVariantPrice: Money;
    };
    /** Present when metafields are configured; `null` for one that isn't set. */
    metafields?: (Metafield | null)[];
    sellingPlanGroups: {
        nodes: SellingPlanGroup[];
    };
    variants: {
        nodes: ProductVariant[];
    };
}
export type ProductFragmentConfig = Pick<TetherConfig, 'imagesFirst' | 'variantsFirst' | 'sellingPlanGroupsFirst' | 'sellingPlansFirst' | 'metafields'>;
/**
 * @param o The list sizes and metafields.
 * @param access What the token may read.
 * @returns `fragment TetherProduct on Product`.
 */
export declare function productFragment(o?: ProductFragmentConfig, access?: StoreAccess): string;
/**
 * @param access What the token may read.
 * @returns `fragment TetherCart on Cart`.
 */
export declare function cartFragment(access?: StoreAccess): string;
export {};
