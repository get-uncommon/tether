import type { AttributeValue } from '../dom.js';
import type { ShopifyCart, Attribute } from './store.js';
export type Attributes = Record<string, AttributeValue> | {
    key: string | number;
    value?: AttributeValue;
}[];
/** A line to add, in any of the shapes `Cart.add` takes. */
export interface LineSpec {
    variantId?: string | number;
    merchandiseId?: string | number;
    id?: string | number;
    quantity?: number | string;
    sellingPlanId?: string | number | null;
    sellingPlan?: string | number | null;
    attributes?: Attributes | null;
}
/** Shopify's `CartLineInput`. */
export interface CartLineInput {
    merchandiseId: string;
    quantity: number;
    sellingPlanId?: string;
    attributes?: Attribute[];
}
/**
 * @returns True when `error` says Shopify doesn't have the cart, false for any other failure (the network, the token,
 *   a line it refused), after which the saved cart is still good.
 */
export declare function isCartGone(error: unknown): boolean;
/**
 * @returns True when a change failed without saying whether Shopify applied it: no answer or no whole body came (the
 *   network), a 2xx whose body isn't valid, or a server error (a 5xx, or a 2xx with `SERVER_ERROR`), which can come
 *   after the change was committed. Shopify's user errors and a 4xx are clear.
 */
export declare function isUnclearFailure(error: unknown): boolean;
/**
 * @param input A variant id, or a line.
 * @param quantity For a variant id.
 * @param options For a variant id.
 * @throws {TetherError} `ERROR` without a variant id.
 */
export declare function toLineInput(input: string | number | LineSpec | null | undefined, quantity?: number, options?: Omit<LineSpec, 'variantId' | 'quantity'>): CartLineInput;
/** A mutation on the saved cart. */
interface CartMutation {
    /** The mutation, e.g. `cartLinesAdd`. */
    name: string;
    /** Its variable definitions besides `$cartId`. */
    args: string;
    /** Its arguments besides `cartId`. */
    inner: string;
    variables: Record<string, unknown>;
    /**
     * The `CartInput` of a new cart that does what the mutation asks, when there is no cart (or Shopify no longer has
     * it); `null` leaves the visitor without a cart instead.
     */
    createInput: Record<string, unknown> | null;
}
/**
 * Runs a mutation on the saved cart, or creates a cart from `createInput` when there is none to change.
 *
 * @returns The changed cart; `null` without a cart and without a `createInput`.
 * @throws {TetherError} For a failed request or Shopify's user errors; also when the cart is gone and there is no
 *   `createInput` (the saved cart is forgotten first).
 */
export declare function mutateCart({ name, args, inner, variables, createInput, }: CartMutation): Promise<ShopifyCart | null>;
/** @returns The cart, `null` when Shopify doesn't have it (expired or checked out). */
export declare function fetchCart(id: string): Promise<ShopifyCart | null>;
/** @returns The cart's current checkout URL, `null` when Shopify doesn't have the cart. */
export declare function fetchCheckoutUrl(id: string): Promise<string | null>;
/** A change to one line, for `updateLine`. */
export interface LinePatch {
    /** 0 or less removes the line. */
    quantity?: number;
    /** `null` switches the line back to one-time purchase. */
    sellingPlanId?: string | number | null;
    attributes?: Attributes;
    merchandiseId?: string | number;
    variantId?: string | number;
}
/** @returns Shopify's `CartLineUpdateInput`. */
export declare function toLineUpdate(lineId: string, patch: number | LinePatch): Record<string, unknown>;
export declare const updateLines: (lines: Record<string, unknown>[]) => Promise<ShopifyCart | null>;
export declare const removeLines: (lineIds: string[]) => Promise<ShopifyCart | null>;
/** @returns The cart once `lineId` has `target` (0 removes it). */
export declare const setLineQuantity: (lineId: string, target: number) => Promise<ShopifyCart | null>;
export {};
