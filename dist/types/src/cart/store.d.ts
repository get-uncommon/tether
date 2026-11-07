import type { CartWarning } from '../config.js';
import type { Image } from '../fragments.js';
import type { Money } from '../shopify-values.js';
export interface Attribute {
    key: string;
    value: string;
}
/** A line's `merchandise`: Shopify's `Merchandise` union has only `ProductVariant`. */
export interface CartVariant {
    id: string;
    title: string;
    sku: string | null;
    availableForSale: boolean;
    requiresShipping: boolean;
    /** Absent when the store's token can't read inventory. */
    quantityAvailable?: number | null;
    image: Image | null;
    price: Money;
    compareAtPrice: Money | null;
    selectedOptions: {
        name: string;
        value: string;
    }[];
    product: {
        id: string;
        title: string;
        handle: string;
        vendor: string;
        featuredImage: Image | null;
    };
}
interface LinePlanAllocation {
    sellingPlan: {
        id: string;
        name: string;
        description: string | null;
        recurringDeliveries: boolean;
        options: {
            name: string;
            value: string;
        }[];
    };
    checkoutChargeAmount: Money;
    priceAdjustments: {
        price: Money;
        compareAtPrice: Money;
        perDeliveryPrice: Money;
    }[];
}
export interface ShopifyCartLine {
    id: string;
    quantity: number;
    attributes: Attribute[];
    cost: {
        totalAmount: Money;
        subtotalAmount: Money;
        amountPerQuantity: Money;
        compareAtAmountPerQuantity: Money | null;
    };
    discountAllocations: {
        discountedAmount: Money;
    }[];
    sellingPlanAllocation: LinePlanAllocation | null;
    merchandise: CartVariant;
    /** Only on a bundle (`ComponentizableCartLine`). */
    lineComponents?: {
        id: string;
        quantity: number;
        merchandise: {
            id: string;
            title: string;
            product: {
                title: string;
                handle: string;
            };
        };
    }[];
}
/** The fields of `fragment TetherCart`. */
export interface ShopifyCart {
    id: string;
    checkoutUrl: string;
    totalQuantity: number;
    note: string | null;
    createdAt: string;
    updatedAt: string;
    attributes: Attribute[];
    buyerIdentity: {
        countryCode: string | null;
        email: string | null;
    };
    discountCodes: {
        code: string;
        applicable: boolean;
    }[];
    cost: {
        subtotalAmount: Money;
        totalAmount: Money;
        checkoutChargeAmount: Money;
    };
    lines: {
        nodes: ShopifyCartLine[];
    };
}
/**
 * `unknown` until the saved cart has loaded (the page's own markup shows); `empty` without a cart (none saved, or
 * Shopify no longer has it); `error` after a failed load or change, with the cart as Shopify last sent it.
 */
export type CartStatus = {
    kind: 'unknown';
} | {
    kind: 'empty';
} | {
    kind: 'ready';
    cart: ShopifyCart;
} | {
    kind: 'error';
    error: unknown;
    cart: ShopifyCart | null;
};
/** What one quick +/- click asked for; a newer click replaces it. */
export interface PendingQuantity {
    quantity: number;
}
/** The second argument of a `subscribe` listener. */
interface CartMeta {
    open: boolean;
    count: number;
    loaded: boolean;
    /** A copy of Shopify's notes on the last change. */
    warnings: CartWarning[];
}
/** Line id → what quick +/- clicks asked for, until Shopify has answered. */
export declare const pendingQuantities: Map<string, PendingQuantity>;
export declare const cartStatus: () => CartStatus;
/** The cart as Shopify last sent it. */
export declare function currentCart(): ShopifyCart | null;
export declare const currentWarnings: () => readonly CartWarning[];
/**
 * The id of the visitor's cart, kept across pages. A stored value that isn't a cart id (written by another script,
 * or edited by hand) is forgotten, so it is never sent to Shopify or the Worker and the next change starts a new cart.
 */
export declare function savedCartId(): string | null;
/** Forgets the saved cart, which Shopify no longer has. */
export declare function forgetSavedCart(): void;
/** Keeps a cart Shopify sent without showing it, for an answer a newer change will replace. */
export declare function keepQuietly(cart: ShopifyCart | null): void;
/** Renders the document with the store's cart. */
export declare function render(): void;
/**
 * Why `tether:cart-updated` fired: `load` when the saved cart was loaded, failed to load or was forgotten; `pending`
 * when quick clicks changed a quantity Shopify doesn't have yet, and `settled` once their last request is done; any
 * other value names the change Shopify just answered. `docs/reference.md` lists them.
 */
export type CartUpdateReason = 'load' | 'add' | 'update' | 'remove' | 'note' | 'attributes' | 'discount' | 'buyer-identity' | 'pending' | 'settled';
/** @param reason The `reason` of `tether:cart-updated`. */
export declare function announce(reason: CartUpdateReason): void;
/**
 * Keeps a cart Shopify sent after a change, shows it, and tells this page and the visitor's other tabs.
 *
 * @returns `cart`.
 */
export declare function commit(cart: ShopifyCart | null, reason: CartUpdateReason): ShopifyCart | null;
/** The outcome of loading the saved cart: the cart, `null` when there is none, or the failure. */
export declare function settleLoad(outcome: {
    kind: 'loaded';
    cart: ShopifyCart | null;
} | {
    kind: 'failed';
    error: unknown;
}): void;
/** Until the saved cart has loaded, the counts show the count it had on the last page instead of the page's 0. */
export declare function showLastKnownCount(): void;
/** Sets Shopify's notes on the last change: each message once, in the site's words (`warningText`). */
export declare function setWarnings(notes: readonly CartWarning[]): void;
/** @returns A runner that starts each task once the one before has settled, whether it succeeded or failed. */
export declare function serial(): <T>(task: () => Promise<T>) => Promise<T>;
/** The one queue every cart change runs through; checkout waits for the changes in it. */
export declare const runInOrder: <T>(task: () => Promise<T>) => Promise<T>;
/**
 * Runs a cart change after the ones before it, so quick clicks never race. A failure sets the `error` status (shown by
 * `tether-show="cart-error"` until the next change succeeds), emits `tether:cart-error` and rejects.
 */
export declare function enqueue<T>(task: () => Promise<T>): Promise<T>;
/** @returns The quantity to show for `line`. */
export declare const pendingQuantityOf: (line: ShopifyCartLine) => number;
/**
 * Calls `listener` now and after every change of the cart or the drawer.
 *
 * @returns Stops listening.
 */
export declare function subscribe(listener: (cart: ShopifyCart | null, meta: CartMeta) => void): () => void;
export {};
