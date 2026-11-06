/**
 * Shopify selling plans (subscriptions): which plans a product and a variant have, and what each costs. Pure, no DOM,
 * shared by the browser script and the server helpers.
 */
import { fromMinorUnits, toMinorUnits } from './amounts.js';
/** @import { Money } from './shopify-values.js' */
/** @import { SellingPlan, SellingPlanGroup, SellingPlanAllocation } from './fragments.js' */

const PERCENT = 100;

/** @typedef {SellingPlan & { group: SellingPlanGroup }} PlanInGroup A plan with the group it belongs to. */
/** @typedef {{ sellingPlanGroups?: { nodes: SellingPlanGroup[] } | null }} ProductWithPlans */
/**
 * A variant as far as plans go. A cart line's variant has no allocations.
 *
 * @typedef {{ price: Money, sellingPlanAllocations?: { nodes: SellingPlanAllocation[] } | null }} VariantWithPlans
 */
/**
 * @typedef {{ type: 'percentage', value: number } | { type: 'amount', value: Money } | { type: 'price', value: Money }}
 *   PlanAdjustment
 */

/**
 * @param {unknown} value A gid, a numeric id, or anything else.
 * @param {string} type The Shopify type, e.g. `ProductVariant`.
 * @returns {string | null} The gid of a numeric id; a gid or other value as written; `null` when empty.
 */
export function toGid(value, type) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!text) return null;
  if (text.startsWith('gid://')) return text;
  if (/^\d+$/.test(text)) return `gid://shopify/${type}/${text}`;
  return text;
}

export const GID = {
  /** @param {unknown} value */
  product: (value) => toGid(value, 'Product'),
  /** @param {unknown} value */
  variant: (value) => toGid(value, 'ProductVariant'),
  /** @param {unknown} value */
  sellingPlan: (value) => toGid(value, 'SellingPlan'),
};

/**
 * @param {ProductWithPlans | null | undefined} product
 * @returns {PlanInGroup[]} All plans of the product, flattened.
 */
export function allPlans(product) {
  const groups = product?.sellingPlanGroups?.nodes ?? [];
  return groups.flatMap((group) => group.sellingPlans.nodes.map((plan) => ({ ...plan, group })));
}

/** @param {ProductWithPlans | null | undefined} product */
export function hasPlans(product) {
  return allPlans(product).length > 0;
}

/**
 * @param {VariantWithPlans | null | undefined} variant
 * @param {string | null | undefined} planId
 * @returns {SellingPlanAllocation | null} The variant's allocation on the plan; `null` when the variant isn't in it.
 */
export function allocationFor(variant, planId) {
  if (!variant || !planId) return null;
  const allocations = variant.sellingPlanAllocations?.nodes ?? [];
  return allocations.find((allocation) => allocation.sellingPlan.id === planId) ?? null;
}

/**
 * @param {ProductWithPlans | null | undefined} product
 * @param {VariantWithPlans | null | undefined} variant
 * @returns {PlanInGroup[]} The plans this variant can be bought on.
 */
export function plansForVariant(product, variant) {
  return allPlans(product).filter((plan) => allocationFor(variant, plan.id));
}

/**
 * @param {VariantWithPlans | null | undefined} variant
 * @param {string | null | undefined} planId
 * @returns {Money | null} The price per delivery on the plan; the one-time price when the variant isn't on it.
 */
export function planPrice(variant, planId) {
  const adjustment = allocationFor(variant, planId)?.priceAdjustments[0];
  return adjustment?.perDeliveryPrice ?? adjustment?.price ?? variant?.price ?? null;
}

/**
 * @param {VariantWithPlans | null | undefined} variant
 * @param {string | null | undefined} planId
 * @returns {Money | null} What the customer pays at checkout on the plan (prepaid plans charge more up front).
 */
export function planCheckoutCharge(variant, planId) {
  const allocation = allocationFor(variant, planId);
  return allocation?.checkoutChargeAmount ?? allocation?.priceAdjustments[0]?.price ?? variant?.price ?? null;
}

/**
 * @param {VariantWithPlans | null | undefined} variant
 * @param {string | null | undefined} planId
 * @returns {{ amount: Money | null, percentage: number }} What the plan saves on the one-time price; no amount and
 *   0% when it saves nothing.
 */
export function planSavings(variant, planId) {
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
 * @param {Pick<SellingPlan, 'priceAdjustments'> | null | undefined} plan
 * @returns {PlanAdjustment | null} The plan's own discount, whatever the variant: a percentage, a fixed amount off or
 *   a fixed price.
 */
export function planAdjustment(plan) {
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
 *
 * @param {ProductWithPlans | null | undefined} product
 * @param {string | null | undefined} ref
 * @returns {PlanInGroup | null}
 */
export function findPlan(product, ref) {
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
