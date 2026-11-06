/**
 * What the browser script shows first for a product, as plain data, so a server renders the same and nothing flashes
 * when Tether takes over. Public as `initialState()` of `@occluze/tether/server`; the rules are `product-state.js`'s,
 * the ones the browser scope uses.
 */
import { DEFAULTS } from './config.js';
import { initialChoice, isValueAvailable, productView } from './product-state.js';
import { allPlans, allocationFor, planPrice, planSavings } from './selling-plans.js';
/** @import { Money } from './shopify-values.js' */
/** @import { Product, ProductVariant } from './fragments.js' */
/** @import { PlanInGroup } from './selling-plans.js' */
/** @import { Selection, ShowCondition } from './product-state.js' */

/**
 * @typedef {object} InitialOptions
 * @property {string | null | undefined} [variant] The page's `?variant=`; the first variant for sale without.
 * @property {string | null | undefined} [sellingPlan] The page's `?selling_plan=`: subscribes on that plan.
 * @property {string | null | undefined} [defaultPurchase] `subscription` subscribes on the first plan.
 * @property {number | undefined} [lowStock] `low-stock` at this many or fewer.
 */
/**
 * @typedef {object} InitialPlan A plan in the plan list (`tether-plan-list`).
 * @property {string} id
 * @property {string} name
 * @property {Money | null} price On this plan, for the variant.
 * @property {number} savings In %, 0 without savings.
 * @property {boolean} selected `is-selected`: the line is bought on this plan.
 * @property {boolean} available The variant is on this plan; `is-unavailable` when not.
 */
/**
 * @typedef {object} InitialState
 * @property {ProductVariant} variant
 * @property {Selection} selected Option name → value of the variant: `is-selected` on those buttons.
 * @property {'one-time' | 'subscription'} purchase
 * @property {PlanInGroup | null} plan The plan the line is bought on, `null` when bought once.
 * @property {InitialPlan[]} plans
 * @property {number} savings The offered plan's savings in % (`tether-bind="subscription-savings"`), 0 without.
 * @property {Money} price
 * @property {Money | null} compareAtPrice Only when on sale.
 * @property {boolean} available
 * @property {Record<ShowCondition, boolean>} show The `tether-show` conditions: `hidden={!state.show['out-of-stock']}`.
 * @property {Record<string, string[]>} unavailable Per option, the values without a variant for sale (given the other
 *   selected values), as plain data for frameworks that serialise props.
 * @property {(name: string, value: string) => boolean} isUnavailable The same as a function: `is-unavailable`.
 */

/**
 * @param {Product | null | undefined} product
 * @param {InitialOptions} [options]
 * @returns {InitialState | null} `null` without a product or variants.
 */
export function initialState(product, options = {}) {
  if (!product) return null;
  const { variant, sellingPlan, defaultPurchase = DEFAULTS.defaultPurchase, lowStock = DEFAULTS.lowStock } = options;
  const choice = initialChoice(product, { variant, sellingPlan, defaultPurchase });
  const view = productView(product, { ...choice, quantity: 1 }, lowStock);
  if (!view) return null;
  const { selected, isSubscription } = view;
  const isUnavailable = (/** @type {string} */ name, /** @type {string} */ value) =>
    !isValueAvailable(product, selected, name, value);
  return {
    variant: view.variant,
    selected,
    purchase: view.purchase.kind,
    plan: isSubscription ? view.plan : null,
    plans: allPlans(product).map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: planPrice(view.variant, plan.id),
      savings: planSavings(view.variant, plan.id).percentage,
      selected: isSubscription && plan.id === view.purchase.planId,
      available: Boolean(allocationFor(view.variant, plan.id)),
    })),
    savings: view.savings.percentage,
    price: view.price,
    compareAtPrice: view.compareAtPrice,
    available: view.variant.availableForSale,
    show: view.show,
    unavailable: Object.fromEntries(
      product.options.map((option) => [
        option.name,
        option.optionValues.map((value) => value.name).filter((value) => isUnavailable(option.name, value)),
      ]),
    ),
    isUnavailable,
  };
}
