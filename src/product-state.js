/**
 * What a product scope shows for the visitor's choice: the variant, the purchase it is bought as, its prices, the
 * text of every `tether-bind` and every `tether-show` condition. Pure, no DOM and no config: the browser scope
 * (`product.js`) and the server's `initialState()` (`initial.js`) derive their view here, so a server-rendered page
 * shows what the script shows when it takes over.
 */
import {
  GID,
  allPlans,
  allocationFor,
  findPlan,
  planAdjustment,
  planCheckoutCharge,
  planPrice,
  planSavings,
} from './selling-plans.js';
/** @import { Money } from './shopify-values.js' */
/** @import { Product, ProductVariant } from './fragments.js' */
/** @import { PlanInGroup } from './selling-plans.js' */

/** @typedef {Record<string, string>} Selection Option name → chosen value. */
/**
 * How the visitor buys. Buying once still names the product's plan when it has plans: the plan the subscription
 * binds (`subscription-price`, `plan-name`) offer next to the one-time price, and the one subscribing switches to.
 *
 * @typedef {{ kind: 'one-time', planId: string | null } | { kind: 'subscription', planId: string }} Purchase
 */
/**
 * @typedef {object} ProductChoice What the visitor chose, before it is checked against the product.
 * @property {Selection} selected
 * @property {Purchase} purchase
 * @property {number} quantity
 */
/**
 * @typedef {'in-stock' | 'out-of-stock' | 'backorder' | 'on-sale' | 'not-on-sale' | 'has-variants' | 'single-variant'
 *   | 'low-stock' | 'plenty-in-stock' | 'subscription-available' | 'subscription-unavailable' | 'subscription-only'
 *   | 'one-time-available' | 'subscription-selected' | 'one-time-selected' | 'has-savings'} ShowCondition
 */
/**
 * @typedef {object} ProductView
 * @property {ProductVariant} variant
 * @property {Selection} selected The selection, matching `variant`.
 * @property {Purchase} purchase The choice, made valid for the product and `variant`.
 * @property {PlanInGroup | null} plan The purchase's plan, offered or chosen.
 * @property {boolean} isSubscription The line is bought on `plan`: subscription chosen and the variant is on it.
 * @property {boolean} subscriptionAvailable The variant is on at least one plan.
 * @property {number} quantity
 * @property {Money} price What one item costs as bought.
 * @property {Money | null} compareAtPrice Only when on sale.
 * @property {{ amount: Money | null, percentage: number }} savings What `plan` saves on the one-time price.
 * @property {Record<ShowCondition, boolean>} show
 */
/**
 * @typedef {object} Formatters How the caller writes values as text.
 * @property {(money: Money | null) => string} money
 * @property {(percentage: number) => string} percent
 */
/** @typedef {string | number | null | undefined} BindText What a bind writes; `null` and `undefined` clear it. */

/** Money arithmetic works in hundredths, the precision Tether shows Shopify's amounts in. */
const MINOR_UNITS_PER_UNIT = 100;
const PERCENT = 100;

/** @param {Money} money */
const toMinorUnits = (money) => Math.round(parseFloat(money.amount) * MINOR_UNITS_PER_UNIT);

/**
 * @param {number} minorUnits
 * @param {string} currencyCode
 * @returns {Money}
 */
const fromMinorUnits = (minorUnits, currencyCode) => ({
  amount: (minorUnits / MINOR_UNITS_PER_UNIT).toFixed(2),
  currencyCode,
});

/**
 * @param {Money} money
 * @param {number} quantity
 */
const timesQuantity = (money, quantity) => fromMinorUnits(toMinorUnits(money) * quantity, money.currencyCode);

/**
 * @param {ProductVariant} variant
 * @returns {Selection}
 */
export const selectionOf = (variant) =>
  Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value]));

/**
 * @param {Product} product
 * @param {Selection} selected
 * @returns {ProductVariant | null} The variant with exactly these option values.
 */
function findVariant(product, selected) {
  return (
    product.variants.nodes.find((variant) =>
      variant.selectedOptions.every((option) => selected[option.name] === option.value),
    ) ?? null
  );
}

/**
 * @param {Product} product
 * @param {Selection} selected
 * @param {string} name An option name.
 * @param {string} value
 * @returns {boolean} True when a variant for sale has this value and the other selected values.
 */
export function isValueAvailable(product, selected, name, value) {
  return product.variants.nodes.some(
    (variant) =>
      variant.availableForSale &&
      variant.selectedOptions.every((option) =>
        option.name === name ? option.value === value : selected[option.name] === option.value,
      ),
  );
}

/**
 * The purchase made valid for the product and variant: one-time without plans, a subscription when the product
 * requires one, and a plan the variant is on when it is on any (else a plan of the product, for the binds to offer).
 *
 * @param {Product} product
 * @param {ProductVariant | null} variant
 * @param {{ kind: Purchase['kind'], planId: string | null }} wanted
 * @returns {Purchase}
 */
export function normalisePurchase(product, variant, wanted) {
  const plans = allPlans(product);
  const known = plans.find((plan) => plan.id === wanted.planId) ?? plans[0];
  if (!known) return { kind: 'one-time', planId: null };
  const onVariant = allocationFor(variant, known.id)
    ? known
    : (plans.find((plan) => allocationFor(variant, plan.id)) ?? known);
  if (product.requiresSellingPlan || wanted.kind === 'subscription')
    return { kind: 'subscription', planId: onVariant.id };
  return { kind: 'one-time', planId: onVariant.id };
}

/**
 * @typedef {object} InitialChoiceOptions
 * @property {string | null | undefined} [variant] A variant id or gid (`?variant=`); the first variant for sale without.
 * @property {string | null | undefined} [sellingPlan] A plan to subscribe on (`?selling_plan=`).
 * @property {string | null | undefined} [defaultPlan] The plan offered first, by id, name or option value.
 * @property {string | null | undefined} [defaultPurchase] `subscription` subscribes; anything else buys once.
 */

/**
 * What a product starts with before the visitor chooses anything.
 *
 * @param {Product} product
 * @param {InitialChoiceOptions} options
 * @returns {Omit<ProductChoice, 'quantity'>}
 */
export function initialChoice(product, { variant, sellingPlan, defaultPlan, defaultPurchase }) {
  const variants = product.variants.nodes;
  const wantedId = GID.variant(variant);
  const start =
    variants.find((candidate) => candidate.id === wantedId) ??
    variants.find((candidate) => candidate.availableForSale) ??
    variants[0] ??
    null;
  const fromUrl = findPlan(product, sellingPlan);
  const offered = fromUrl ?? findPlan(product, defaultPlan);
  const kind = fromUrl || defaultPurchase === 'subscription' ? 'subscription' : 'one-time';
  return {
    selected: start ? selectionOf(start) : {},
    purchase: normalisePurchase(product, start, { kind, planId: offered?.id ?? null }),
  };
}

/**
 * @param {ProductVariant} variant
 * @param {number} lowStock
 * @param {number} variantCount
 * @param {Pick<ProductView, 'isSubscription' | 'subscriptionAvailable' | 'compareAtPrice' | 'savings'>} sale
 * @param {boolean} requiresSellingPlan
 * @returns {Record<ShowCondition, boolean>}
 */
function showConditions(variant, lowStock, variantCount, sale, requiresSellingPlan) {
  const stock = variant.quantityAvailable;
  const low = stock != null && stock > 0 && stock <= lowStock;
  const onSale = sale.compareAtPrice !== null;
  return {
    'in-stock': variant.availableForSale,
    'out-of-stock': !variant.availableForSale,
    backorder: variant.availableForSale && variant.currentlyNotInStock,
    'on-sale': onSale,
    'not-on-sale': !onSale,
    'has-variants': variantCount > 1,
    'single-variant': variantCount === 1,
    'low-stock': low,
    'plenty-in-stock': variant.availableForSale && !low,
    'subscription-available': sale.subscriptionAvailable,
    'subscription-unavailable': !sale.subscriptionAvailable,
    'subscription-only': requiresSellingPlan,
    'one-time-available': !requiresSellingPlan,
    'subscription-selected': sale.isSubscription,
    'one-time-selected': !sale.isSubscription,
    'has-savings': sale.isSubscription ? sale.savings.percentage > 0 : onSale,
  };
}

/**
 * The view for the visitor's choice. A selection no variant has falls back to the first variant.
 *
 * @param {Product} product
 * @param {ProductChoice} choice
 * @param {number} lowStock `low-stock` at this many or fewer.
 * @returns {ProductView | null} `null` for a product without variants.
 */
export function productView(product, choice, lowStock) {
  const exact = findVariant(product, choice.selected);
  const variant = exact ?? product.variants.nodes[0];
  if (!variant) return null;
  const purchase = normalisePurchase(product, variant, choice.purchase);
  const { planId } = purchase;
  const plans = allPlans(product);
  const allocation = purchase.kind === 'subscription' ? allocationFor(variant, planId) : null;
  // The plan helpers fall back to the one-time price only without a variant, which `variant` rules out.
  const price = allocation ? (planPrice(variant, planId) ?? variant.price) : variant.price;
  const compareAt = allocation?.priceAdjustments[0]?.compareAtPrice ?? variant.compareAtPrice;
  const sale = {
    isSubscription: allocation !== null,
    subscriptionAvailable: plans.some((plan) => allocationFor(variant, plan.id)),
    compareAtPrice: compareAt && parseFloat(compareAt.amount) > parseFloat(price.amount) ? compareAt : null,
    savings: planSavings(variant, planId),
  };
  return {
    ...sale,
    variant,
    selected: exact ? choice.selected : selectionOf(variant),
    purchase,
    plan: plans.find((plan) => plan.id === planId) ?? null,
    quantity: choice.quantity,
    price,
    show: showConditions(variant, lowStock, product.variants.nodes.length, sale, product.requiresSellingPlan),
  };
}

/**
 * The `tether-bind` values that follow the variant and purchase. Thunks, so only the binds on the page are computed.
 *
 * @param {ProductView} view
 * @param {Formatters} format
 * @returns {Map<string, () => BindText>}
 */
export function variantBindTexts(view, format) {
  const { variant, plan, price, compareAtPrice, quantity } = view;
  const planId = view.purchase.planId;
  // Prices for the quantity count one item when it is 0 (an optional bundle item).
  const forQuantity = (/** @type {Money} */ money) => timesQuantity(money, Math.max(1, quantity));
  const checkoutCharge = () => {
    const charge = view.isSubscription ? (planCheckoutCharge(variant, planId) ?? price) : price;
    return format.money(forQuantity(charge));
  };
  const discountPercentage = () => {
    if (!compareAtPrice) return '0%';
    return `${Math.round((1 - parseFloat(price.amount) / parseFloat(compareAtPrice.amount)) * PERCENT)}%`;
  };
  const discountAmount = () => {
    if (!compareAtPrice) return '';
    return format.money(fromMinorUnits(toMinorUnits(compareAtPrice) - toMinorUnits(price), price.currencyCode));
  };
  /** @type {Record<string, () => BindText>} */
  const texts = {
    price: () => format.money(price),
    'total-price': () => format.money(forQuantity(price)),
    'one-time-price': () => format.money(variant.price),
    'subscription-price': () => format.money(planId ? planPrice(variant, planId) : null),
    'subscription-savings': () => format.percent(view.savings.percentage),
    'subscription-savings-amount': () => format.money(view.savings.amount),
    'checkout-charge': checkoutCharge,
    'plan-name': () => plan?.name,
    'plan-description': () => plan?.description,
    'plan-group': () => plan?.group.name,
    'compare-at-price': () => format.money(compareAtPrice),
    'unit-price': () => format.money(variant.unitPrice),
    'discount-percentage': discountPercentage,
    'discount-amount': discountAmount,
    'variant-title': () => variant.title,
    'variant-id': () => variant.id,
    sku: () => variant.sku,
    barcode: () => variant.barcode,
    stock: () => variant.quantityAvailable,
    quantity: () => quantity,
  };
  return new Map(Object.entries(texts));
}
/**
 * The `tether-plan-bind` values of one plan in a plan list, for the variant.
 *
 * @param {ProductVariant} variant
 * @param {string} planId The list item's `tether-plan-value`.
 * @param {PlanInGroup | undefined} plan The product's plan with that id.
 * @param {Formatters} format
 * @returns {Map<string, () => BindText>}
 */
export function planBindTexts(variant, planId, plan, format) {
  const adjustmentText = () => {
    const adjustment = planAdjustment(plan);
    if (!adjustment) return '';
    return adjustment.type === 'percentage' ? `${adjustment.value}%` : format.money(adjustment.value);
  };
  /** @type {Record<string, () => BindText>} */
  const texts = {
    name: () => plan?.name,
    // The option values alone ("1 month"), without the price text a store may put in the plan name.
    option: () => (plan?.options ?? []).map((option) => option.value).join(', '),
    description: () => plan?.description,
    price: () => format.money(planPrice(variant, planId)),
    savings: () => format.percent(planSavings(variant, planId).percentage),
    'savings-amount': () => format.money(planSavings(variant, planId).amount),
    adjustment: adjustmentText,
  };
  return new Map(Object.entries(texts));
}
