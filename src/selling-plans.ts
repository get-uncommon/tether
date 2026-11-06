/**
 * Shopify selling plans (subscriptions): which plans a product and a variant have, and what each costs. Pure, no DOM,
 * shared by the browser script and the server helpers.
 */
import { fromMinorUnits, toMinorUnits } from './amounts.ts';
import type { Money } from './shopify-values.ts';
import type { SellingPlan, SellingPlanGroup, SellingPlanAllocation } from './fragments.ts';

const PERCENT = 100;

/** A plan with the group it belongs to. */
export type PlanInGroup = SellingPlan & { group: SellingPlanGroup };
export interface ProductWithPlans {
  sellingPlanGroups?: { nodes: SellingPlanGroup[] } | null;
}
/** A variant as far as plans go. A cart line's variant has no allocations. */
export interface VariantWithPlans {
  price: Money;
  sellingPlanAllocations?: { nodes: SellingPlanAllocation[] } | null;
}
export type PlanAdjustment =
  { type: 'percentage'; value: number } | { type: 'amount'; value: Money } | { type: 'price'; value: Money };

/**
 * @param value A gid, a numeric id, or anything else.
 * @param type The Shopify type, e.g. `ProductVariant`.
 * @returns The gid of a numeric id; a gid or other value as written; `null` when empty.
 */
export function toGid(value: unknown, type: string): string | null {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!text) return null;
  if (text.startsWith('gid://')) return text;
  if (/^\d+$/.test(text)) return `gid://shopify/${type}/${text}`;
  return text;
}

export const GID = {
  product: (value: unknown) => toGid(value, 'Product'),
  variant: (value: unknown) => toGid(value, 'ProductVariant'),
  sellingPlan: (value: unknown) => toGid(value, 'SellingPlan'),
};

/** @returns All plans of the product, flattened. */
export function allPlans(product: ProductWithPlans | null | undefined): PlanInGroup[] {
  const groups = product?.sellingPlanGroups?.nodes ?? [];
  return groups.flatMap((group) => group.sellingPlans.nodes.map((plan) => ({ ...plan, group })));
}

export function hasPlans(product: ProductWithPlans | null | undefined): boolean {
  return allPlans(product).length > 0;
}

/** @returns The variant's allocation on the plan; `null` when the variant isn't in it. */
export function allocationFor(
  variant: VariantWithPlans | null | undefined,
  planId: string | null | undefined,
): SellingPlanAllocation | null {
  if (!variant || !planId) return null;
  const allocations = variant.sellingPlanAllocations?.nodes ?? [];
  return allocations.find((allocation) => allocation.sellingPlan.id === planId) ?? null;
}

/** @returns The plans this variant can be bought on. */
export function plansForVariant(
  product: ProductWithPlans | null | undefined,
  variant: VariantWithPlans | null | undefined,
): PlanInGroup[] {
  return allPlans(product).filter((plan) => allocationFor(variant, plan.id));
}

/** @returns The price per delivery on the plan; the one-time price when the variant isn't on it. */
export function planPrice(
  variant: VariantWithPlans | null | undefined,
  planId: string | null | undefined,
): Money | null {
  const adjustment = allocationFor(variant, planId)?.priceAdjustments[0];
  return adjustment?.perDeliveryPrice ?? adjustment?.price ?? variant?.price ?? null;
}

/** @returns What the customer pays at checkout on the plan (prepaid plans charge more up front). */
export function planCheckoutCharge(
  variant: VariantWithPlans | null | undefined,
  planId: string | null | undefined,
): Money | null {
  const allocation = allocationFor(variant, planId);
  return allocation?.checkoutChargeAmount ?? allocation?.priceAdjustments[0]?.price ?? variant?.price ?? null;
}

/** @returns What the plan saves on the one-time price; no amount and 0% when it saves nothing. */
export function planSavings(
  variant: VariantWithPlans | null | undefined,
  planId: string | null | undefined,
): { amount: Money | null; percentage: number } {
  const onPlanPrice = planPrice(variant, planId);
  if (!variant || !onPlanPrice) return { amount: null, percentage: 0 };
  const oneTime = parseFloat(variant.price.amount);
  const onPlan = parseFloat(onPlanPrice.amount);
  if (!Number.isFinite(oneTime) || !Number.isFinite(onPlan) || oneTime <= 0 || onPlan >= oneTime) {
    return { amount: null, percentage: 0 };
  }
  const saved = toMinorUnits(variant.price) - toMinorUnits(onPlanPrice);
  return {
    amount: fromMinorUnits(saved, variant.price.currencyCode),
    percentage: Math.round((1 - onPlan / oneTime) * PERCENT),
  };
}

/**
 * @returns The plan's own discount, whatever the variant: a percentage, a fixed amount off or a fixed price.
 */
export function planAdjustment(plan: Pick<SellingPlan, 'priceAdjustments'> | null | undefined): PlanAdjustment | null {
  const value = plan?.priceAdjustments[0]?.adjustmentValue;
  if (!value) return null;
  switch (value.__typename) {
    case 'SellingPlanPercentagePriceAdjustment':
      return { type: 'percentage', value: value.adjustmentPercentage };
    case 'SellingPlanFixedAmountPriceAdjustment':
      return { type: 'amount', value: value.adjustmentAmount };
    case 'SellingPlanFixedPriceAdjustment':
      return { type: 'price', value: value.price };
    default:
      // An adjustment type newer than the API version Tether was written for.
      return null;
  }
}

/**
 * Finds a plan by id, numeric id, name or option value (case-insensitive), so Webflow editors can write
 * `tether-default-plan="Every month"`.
 */
export function findPlan(
  product: ProductWithPlans | null | undefined,
  ref: string | null | undefined,
): PlanInGroup | null {
  if (!ref) return null;
  const plans = allPlans(product);
  const gid = GID.sellingPlan(ref);
  const needle = ref.trim().toLowerCase();
  return (
    plans.find((plan) => plan.id === gid) ??
    plans.find((plan) => plan.name.toLowerCase() === needle) ??
    plans.find((plan) => plan.options.some((option) => option.value.toLowerCase() === needle)) ??
    null
  );
}
