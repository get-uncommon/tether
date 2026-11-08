import type { Money } from './shopify-values.js';
import type { SellingPlan, SellingPlanGroup, SellingPlanAllocation } from './fragments.js';
/** A plan with the group it belongs to. */
export type PlanInGroup = SellingPlan & {
    group: SellingPlanGroup;
};
export interface ProductWithPlans {
    sellingPlanGroups?: {
        nodes: SellingPlanGroup[];
    } | null;
}
/** A variant as far as plans go. A cart line's variant has no allocations. */
export interface VariantWithPlans {
    price: Money;
    sellingPlanAllocations?: {
        nodes: SellingPlanAllocation[];
    } | null;
}
export type PlanAdjustment = {
    type: 'percentage';
    value: number;
} | {
    type: 'amount';
    value: Money;
} | {
    type: 'price';
    value: Money;
};
/**
 * @param value A gid, a numeric id, or anything else.
 * @param type The Shopify type, e.g. `ProductVariant`.
 * @returns The gid of a numeric id; a gid or other value as written; `null` when empty.
 */
export declare function toGid(value: unknown, type: string): string | null;
export declare const GID: {
    product: (value: unknown) => string | null;
    variant: (value: unknown) => string | null;
    sellingPlan: (value: unknown) => string | null;
};
/** @returns All plans of the product, flattened. */
export declare function allPlans(product: ProductWithPlans | null | undefined): PlanInGroup[];
export declare function hasPlans(product: ProductWithPlans | null | undefined): boolean;
/** @returns The variant's allocation on the plan; `null` when the variant isn't in it. */
export declare function allocationFor(variant: VariantWithPlans | null | undefined, planId: string | null | undefined): SellingPlanAllocation | null;
/** @returns The plans this variant can be bought on. */
export declare function plansForVariant(product: ProductWithPlans | null | undefined, variant: VariantWithPlans | null | undefined): PlanInGroup[];
/** @returns The price per delivery on the plan; the one-time price when the variant isn't on it. */
export declare function planPrice(variant: VariantWithPlans | null | undefined, planId: string | null | undefined): Money | null;
/** @returns What the customer pays at checkout on the plan (prepaid plans charge more up front). */
export declare function planCheckoutCharge(variant: VariantWithPlans | null | undefined, planId: string | null | undefined): Money | null;
/** @returns What the plan saves on the one-time price; no amount and 0% when it saves nothing. */
export declare function planSavings(variant: VariantWithPlans | null | undefined, planId: string | null | undefined): {
    amount: Money | null;
    percentage: number;
};
/**
 * @returns The plan's own discount, whatever the variant: a percentage, a fixed amount off or a fixed price.
 */
export declare function planAdjustment(plan: Pick<SellingPlan, 'priceAdjustments'> | null | undefined): PlanAdjustment | null;
/**
 * Finds a plan by id, numeric id, name or option value (case-insensitive), so Webflow editors can write
 * `tether-default-plan="Every month"`.
 */
export declare function findPlan(product: ProductWithPlans | null | undefined, ref: string | null | undefined): PlanInGroup | null;
