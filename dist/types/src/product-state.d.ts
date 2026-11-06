import type { Money } from './shopify-values.js';
import type { Product, ProductVariant } from './fragments.js';
import type { PlanInGroup } from './selling-plans.js';
/** Option name → chosen value. */
export type Selection = Record<string, string>;
/**
 * How the visitor wants to buy. Buying once keeps the plan offered next to the one-time price (the subscription
 * binds `subscription-price` and `plan-name` show it, and subscribing switches to it); `null` for a product without
 * plans.
 */
export type Purchase = {
    kind: 'one-time';
    offeredPlanId: string | null;
} | {
    kind: 'subscription';
    planId: string;
};
/** How the line is bought: on a plan only when the visitor subscribes and the variant is on that plan. */
type LinePurchase = {
    kind: 'one-time';
} | {
    kind: 'subscription';
    planId: string;
};
/** What the visitor chose, before it is checked against the product. */
interface ProductChoice {
    selected: Selection;
    purchase: Purchase;
    quantity: number;
}
export type ShowCondition = 'in-stock' | 'out-of-stock' | 'backorder' | 'on-sale' | 'not-on-sale' | 'has-variants' | 'single-variant' | 'low-stock' | 'plenty-in-stock' | 'subscription-available' | 'subscription-unavailable' | 'subscription-only' | 'one-time-available' | 'subscription-selected' | 'one-time-selected' | 'has-savings';
export interface ProductView {
    variant: ProductVariant;
    /** The selection, matching `variant`. */
    selected: Selection;
    /** The choice, made valid for the product and `variant`. */
    purchase: Purchase;
    /** The purchase's plan, offered or chosen. */
    plan: PlanInGroup | null;
    /** How the line is bought. */
    line: LinePurchase;
    /** The variant is on at least one plan. */
    subscriptionAvailable: boolean;
    quantity: number;
    /** What one item costs as bought. */
    price: Money;
    /** Only when on sale. */
    compareAtPrice: Money | null;
    /** What `plan` saves on the one-time price. */
    savings: {
        amount: Money | null;
        percentage: number;
    };
    show: Record<ShowCondition, boolean>;
}
/** How the caller writes values as text. */
export interface Formatters {
    money: (money: Money | null) => string;
    percent: (percentage: number) => string;
}
/** What a bind writes; `null` and `undefined` clear it. */
type BindText = string | number | null | undefined;
export declare const selectionOf: (variant: ProductVariant) => Selection;
/**
 * @param name An option name.
 * @returns True when a variant for sale has this value and the other selected values.
 */
export declare function isValueAvailable(product: Product, selected: Selection, name: string, value: string): boolean;
/** @returns The plan subscribed on, or offered while buying once. */
export declare const purchasePlanId: (purchase: Purchase) => string | null;
/** @returns On the plan when subscribing and the variant is on it, else once. */
export declare function linePurchase(purchase: Purchase, variant: ProductVariant | null): LinePurchase;
/**
 * The purchase the visitor wants, made valid for the product and variant: one-time without plans, a subscription when
 * the product requires one, and a plan the variant is on when it is on any (else a plan of the product, for the binds
 * to offer).
 *
 * @param kind The way of buying the visitor asked for.
 * @param preferredPlanId The plan to keep when it is the product's: the visitor's last one.
 */
export declare function normalisePurchase(product: Product, variant: ProductVariant | null, kind: Purchase['kind'], preferredPlanId: string | null): Purchase;
interface InitialChoiceOptions {
    /** A variant id or gid (`?variant=`); the first variant for sale without. */
    variant?: string | null | undefined;
    /** A plan to subscribe on (`?selling_plan=`). */
    sellingPlan?: string | null | undefined;
    /** The plan offered first, by id, name or option value. */
    defaultPlan?: string | null | undefined;
    /** `subscription` subscribes; anything else buys once. */
    defaultPurchase?: string | null | undefined;
}
/** What a product starts with before the visitor chooses anything. */
export declare function initialChoice(product: Product, { variant, sellingPlan, defaultPlan, defaultPurchase }: InitialChoiceOptions): Omit<ProductChoice, 'quantity'>;
/**
 * The view for the visitor's choice. A selection no variant has falls back to the first variant.
 *
 * @param lowStock `low-stock` at this many or fewer.
 * @returns `null` for a product without variants.
 */
export declare function productView(product: Product, choice: ProductChoice, lowStock: number): ProductView | null;
/** The `tether-bind` values that follow the variant and purchase. Thunks, so only the binds on the page are computed. */
export declare function variantBindTexts(view: ProductView, format: Formatters): Map<string, () => BindText>;
/**
 * The `tether-plan-bind` values of one plan in a plan list, for the variant.
 *
 * @param planId The list item's `tether-plan-value`.
 * @param plan The product's plan with that id.
 */
export declare function planBindTexts(variant: ProductVariant, planId: string, plan: PlanInGroup | undefined, format: Formatters): Map<string, () => BindText>;
export {};
