import type { Money } from './shopify-values.js';
import type { Product, ProductVariant } from './fragments.js';
import type { PlanInGroup } from './selling-plans.js';
import type { Selection, ShowCondition } from './product-state.js';
export interface InitialOptions {
    /** The page's `?variant=`; the first variant for sale without. */
    variant?: string | null | undefined;
    /** The page's `?selling_plan=`: subscribes on that plan. */
    sellingPlan?: string | null | undefined;
    /** `subscription` subscribes on the first plan. */
    defaultPurchase?: string | null | undefined;
    /** `low-stock` at this many or fewer. */
    lowStock?: number | undefined;
}
/** A plan in the plan list (`tether-plan-list`). */
interface InitialPlan {
    id: string;
    name: string;
    /** On this plan, for the variant. */
    price: Money | null;
    /** In %, 0 without savings. */
    savings: number;
    /** `is-selected`: the line is bought on this plan. */
    selected: boolean;
    /** The variant is on this plan; `is-unavailable` when not. */
    available: boolean;
}
export interface InitialState {
    variant: ProductVariant;
    /** Option name → value of the variant: `is-selected` on those buttons. */
    selected: Selection;
    purchase: 'one-time' | 'subscription';
    /** The plan the line is bought on, `null` when bought once. */
    plan: PlanInGroup | null;
    plans: InitialPlan[];
    /** The offered plan's savings in % (`tether-bind="subscription-savings"`), 0 without. */
    savings: number;
    price: Money;
    /** Only when on sale. */
    compareAtPrice: Money | null;
    available: boolean;
    /** The `tether-show` conditions: `hidden={!state.show['out-of-stock']}`. */
    show: Record<ShowCondition, boolean>;
    /**
     * Per option, the values without a variant for sale (given the other selected values), as plain data for
     * frameworks that serialise props.
     */
    unavailable: Record<string, string[]>;
    /** The same as a function: `is-unavailable`. */
    isUnavailable: (name: string, value: string) => boolean;
}
/** @throws TetherError For a product without variants, which Shopify never sends: every product has one. */
export declare function initialState(product: Product, options?: InitialOptions): InitialState;
/** @returns `null` without a product. */
export declare function initialState(product: Product | null | undefined, options?: InitialOptions): InitialState | null;
export {};
