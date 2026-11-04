/**
 * What the browser script will show first for a product, so a server can render the same
 * (no flash when Tether takes over): the selected variant, price, purchase mode and conditions.
 * Same rules as src/product.js: first available variant (or the one in ?variant=), subscription
 * when the product requires a plan or defaultPurchase is 'subscription', low stock at 5 or fewer.
 */
import { GID, allPlans, allocationFor, findPlan, planPrice, planSavings } from './selling-plans.js';

export function initialState(product, { variant, sellingPlan, defaultPurchase = 'one-time' } = {}) {
  const vs = product?.variants?.nodes || [];
  const gid = variant ? GID.variant(variant) : null;
  const v = (gid && vs.find((x) => x.id === gid)) || vs.find((x) => x.availableForSale) || vs[0] || null;
  if (!v) return null;
  const selected = Object.fromEntries((v.selectedOptions || []).map((o) => [o.name, o.value]));

  const plans = allPlans(product);
  const fromUrl = findPlan(product, sellingPlan);
  let plan = plans.length ? (fromUrl || plans[0]) : null;
  if (plan && !allocationFor(v, plan.id)) plan = plans.find((p) => allocationFor(v, p.id)) || plan;
  const wantsSub = product.requiresSellingPlan || fromUrl || defaultPurchase === 'subscription';
  const subscriptionAvailable = plans.some((p) => allocationFor(v, p.id));
  const purchase = plans.length && wantsSub ? 'subscription' : 'one-time';
  const sub = purchase === 'subscription' && subscriptionAvailable;

  const price = sub ? planPrice(v, plan.id) : v.price;
  const compareAt = sub ? (allocationFor(v, plan.id)?.priceAdjustments?.[0]?.compareAtPrice || v.compareAtPrice) : v.compareAtPrice;
  const onSale = Boolean(compareAt && parseFloat(compareAt.amount) > parseFloat(price.amount));
  const q = v.quantityAvailable;

  return {
    variant: v,
    selected,
    purchase,
    plan: sub ? plan : null,
    /** The plan list (tether-plan-list="all"): selected one gets is-selected, unavailable ones is-unavailable. */
    plans: plans.map((p) => ({
      id: p.id, name: p.name, price: planPrice(v, p.id), savings: planSavings(v, p.id).percentage,
      selected: sub && p.id === plan.id, available: Boolean(allocationFor(v, p.id)),
    })),
    /** Savings of the selected plan in % (tether-bind="subscription-savings"), 0 without one. */
    savings: plan ? planSavings(v, plan.id).percentage : 0,
    price,
    compareAtPrice: onSale ? compareAt : null,
    available: v.availableForSale,
    /** The tether-show conditions, e.g. hidden={!state.show['out-of-stock']}. */
    show: {
      'in-stock': v.availableForSale,
      'out-of-stock': !v.availableForSale,
      backorder: Boolean(v.availableForSale && v.currentlyNotInStock),
      'on-sale': onSale,
      'not-on-sale': !onSale,
      'has-variants': vs.length > 1,
      'single-variant': vs.length === 1,
      'low-stock': q != null && q > 0 && q <= 5,
      'subscription-available': subscriptionAvailable,
      'subscription-unavailable': !subscriptionAvailable,
      'subscription-only': Boolean(product.requiresSellingPlan),
      'one-time-available': !product.requiresSellingPlan,
      'subscription-selected': sub,
      'one-time-selected': !sub,
    },
    /** Option values with no available variant (given the other selected options): class is-unavailable. */
    isUnavailable: (name, value) => !vs.some((x) => x.availableForSale && x.selectedOptions.every((o) =>
      (o.name === name ? o.value === value : selected[o.name] === o.value))),
  };
}
