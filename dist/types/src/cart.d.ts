import { checkout, setCheckoutResolver } from './cart/checkout.js';
import { isOpen, openCart, closeCart, toggleCart, trapFocus } from './cart/drawer.js';
import { render, savedCartId, subscribe } from './cart/store.js';
import type { CartWarning } from './config.js';
import type { Attributes, LineSpec, LinePatch } from './cart/mutations.js';
import type { ShopifyCart, ShopifyCartLine, CartStatus } from './cart/store.js';
export { trapFocus };
type DiscountCodes = string[] | string | ((current: string[]) => string[]);
/**
 * +1 / -1 for a line. Quick clicks add up: each builds on the quantity the click before asked for, which shows at once
 * (`tether-line="quantity"`, `quantityOf`) until Shopify has answered. Only the latest target is sent; the ones it
 * replaced are skipped.
 */
declare function changeQuantity(lineId: string, delta: number): Promise<ShopifyCart | null>;
/**
 * Loads the saved cart. A cart Shopify no longer has is forgotten; one it can't be asked about (the network, the
 * token) is kept, because it is probably fine.
 */
declare function init(): Promise<ShopifyCart | null>;
export declare const Cart: {
    init: typeof init;
    /** The saved cart's id. */
    id: typeof savedCartId;
    readonly status: CartStatus;
    readonly state: ShopifyCart | null;
    /** The cart's lines, a copy: changing it changes nothing in the cart. */
    readonly lines: ShopifyCartLine[];
    readonly count: number;
    /** True once the saved cart, or that there is none, is known. */
    readonly loaded: boolean;
    /**
     * The failure of the last load or change, until a change succeeds. Requests fail with an `Error`; anything else
     * thrown is wrapped, so the public type holds.
     */
    readonly lastError: Error | null;
    /** Shopify's notes on the last change, a copy. */
    readonly warnings: CartWarning[];
    /** Line id → the quantity quick clicks asked for. */
    readonly pendingQty: ReadonlyMap<string, {
        quantity: number;
    }>;
    /**
     * Sets where a logged-in customer checks out, or clears it with `null`: the account part's resolver answers the
     * customer's checkout URL for the cart (`null` uses the cart's own).
     */
    setCheckoutResolver: typeof setCheckoutResolver;
    /**
     * Forgets the saved cart on this device, as if there were none: the page shows an empty cart and
     * `tether:cart-updated` fires with reason `load`. The next add starts a new cart.
     */
    forgetSaved(): void;
    render: typeof render;
    subscribe: typeof subscribe;
    /**
     * `add(variantId, 2)`, `add({ variantId, quantity, sellingPlanId, attributes })`, or `add([line, line])` for
     * bundles in one request. Creates the cart when there is none.
     *
     * @throws {TetherError} (rejected) When the add fails, or Shopify answers it without a cart.
     */
    add(input: string | number | LineSpec | (string | number | LineSpec)[], quantity?: number, options?: Omit<LineSpec, "variantId" | "quantity">): Promise<ShopifyCart>;
    /**
     * `updateLine(lineId, 3)` or `updateLine(lineId, { quantity, sellingPlanId, attributes })`.
     *
     * @param patch A quantity of 0 or less removes the line.
     */
    updateLine(lineId: string, patch: number | LinePatch): Promise<ShopifyCart | null>;
    changeQuantity: typeof changeQuantity;
    /** The quantity to show: the one asked for while an update is on its way. */
    quantityOf: (line: ShopifyCartLine) => number;
    removeLine(lineIds: string | string[]): Promise<ShopifyCart | null>;
    /** Removes the lines the cart has when the change runs, so one queued just before it is cleared too. */
    clear(): Promise<ShopifyCart | null>;
    setNote(note: string | null | undefined): Promise<ShopifyCart | null>;
    /**
     * Cart attributes, merged with the cart's (as it is when the change runs, so quick calls don't drop each other).
     *
     * @param attributes The value `''` removes a key.
     */
    setAttributes(attributes: Attributes): Promise<ShopifyCart | null>;
    /** Replaces the discount codes; `[]` removes them all. */
    setDiscountCodes(codes: DiscountCodes): Promise<ShopifyCart | null>;
    /**
     * Adds a code. A code Shopify doesn't accept is removed again, so it doesn't warn on every later change.
     *
     * @throws {TetherError} `INVALID_DISCOUNT` (rejected) when Shopify doesn't accept the code, or it is blank.
     */
    applyDiscount(typed: string): Promise<ShopifyCart | null>;
    removeDiscount(code: string): Promise<ShopifyCart | null>;
    /**
     * Sets who is buying; a country changes the cart's currency and prices to that market's.
     *
     * @param options `create: false` forgets an expired cart instead of creating an empty one.
     */
    setBuyerIdentity(buyerIdentity: {
        countryCode?: string;
        email?: string;
        phone?: string;
    }, { create }?: {
        create?: boolean;
    }): Promise<ShopifyCart | null>;
    checkout: typeof checkout;
    drawers: () => HTMLElement[];
    isOpen: typeof isOpen;
    open: typeof openCart;
    close: typeof closeCart;
    toggle: typeof toggleCart;
};
