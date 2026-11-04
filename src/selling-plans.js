/**
 * Pure helpers for Shopify selling plans (subscriptions). No DOM, easy to test.
 */

export const GID = {
  product: (v) => toGid(v, 'Product'),
  variant: (v) => toGid(v, 'ProductVariant'),
  sellingPlan: (v) => toGid(v, 'SellingPlan'),
};

export function toGid(value, type) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (v.startsWith('gid://')) return v;
  if (/^\d+$/.test(v)) return `gid://shopify/${type}/${v}`;
  return v;
}

/** All plans of a product, flattened, each with its group attached. */
export function allPlans(product) {
  const groups = product?.sellingPlanGroups?.nodes || [];
  return groups.flatMap((g) => (g.sellingPlans?.nodes || []).map((p) => ({ ...p, group: g })));
}

export function hasPlans(product) {
  return allPlans(product).length > 0;
}

/** The allocation of `planId` on `variant`, or null when the variant isn't in that plan. */
export function allocationFor(variant, planId) {
  if (!variant || !planId) return null;
  return (variant.sellingPlanAllocations?.nodes || []).find((a) => a.sellingPlan?.id === planId) || null;
}

/** Plans that can actually be bought with this variant. */
export function plansForVariant(product, variant) {
  return allPlans(product).filter((p) => allocationFor(variant, p.id));
}

/** Price per delivery for a variant on a plan (falls back to the one-time price). */
export function planPrice(variant, planId) {
  const a = allocationFor(variant, planId);
  const adj = a?.priceAdjustments?.[0];
  return adj?.perDeliveryPrice || adj?.price || variant?.price || null;
}

/** What the customer pays at checkout for this plan (prepaid plans charge more up front). */
export function planCheckoutCharge(variant, planId) {
  const a = allocationFor(variant, planId);
  return a?.checkoutChargeAmount || a?.priceAdjustments?.[0]?.price || variant?.price || null;
}

/** Savings of a plan vs the one-time price, as { amount, percentage }. */
export function planSavings(variant, planId) {
  const base = parseFloat(variant?.price?.amount);
  const sub = parseFloat(planPrice(variant, planId)?.amount);
  if (!Number.isFinite(base) || !Number.isFinite(sub) || base <= 0 || sub >= base) {
    return { amount: null, percentage: 0 };
  }
  return {
    amount: { amount: (base - sub).toFixed(2), currencyCode: variant.price.currencyCode },
    percentage: Math.round((1 - sub / base) * 100),
  };
}

/**
 * The plan's own discount description, independent of a variant:
 * '10%', or a fixed amount / fixed price.
 */
export function planAdjustment(plan) {
  const v = plan?.priceAdjustments?.[0]?.adjustmentValue;
  if (!v) return null;
  switch (v.__typename) {
    case 'SellingPlanPercentagePriceAdjustment': return { type: 'percentage', value: v.adjustmentPercentage };
    case 'SellingPlanFixedAmountPriceAdjustment': return { type: 'amount', value: v.adjustmentAmount };
    case 'SellingPlanFixedPriceAdjustment': return { type: 'price', value: v.price };
    default: return null;
  }
}

/**
 * Finds a plan by id, numeric id, name or option value (case-insensitive),
 * so Webflow editors can write tether-default-plan="Every month".
 */
export function findPlan(product, ref) {
  if (!ref) return null;
  const plans = allPlans(product);
  const gid = GID.sellingPlan(ref);
  const needle = String(ref).trim().toLowerCase();
  return plans.find((p) => p.id === gid)
    || plans.find((p) => p.name.toLowerCase() === needle)
    || plans.find((p) => (p.options || []).some((o) => String(o.value).toLowerCase() === needle))
    || null;
}
