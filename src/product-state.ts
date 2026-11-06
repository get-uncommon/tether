/**
 * What a product scope shows for the visitor's choice: the variant, the purchase it is bought as, its prices, the
 * text of every `tether-bind` and every `tether-show` condition. Pure, no DOM and no config: the browser scope
 * (`product.ts`) and the server's `initialState()` (`initial.ts`) derive their view here, so a server-rendered page
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
} from './selling-plans.ts';
import { fromMinorUnits, toMinorUnits } from './amounts.ts';
import type { Money } from './shopify-values.ts';
import type { Product, ProductVariant } from './fragments.ts';
import type { PlanInGroup } from './selling-plans.ts';

/** Option name → chosen value. */
export type Selection = Record<string, string>;
/**
 * How the visitor wants to buy. Buying once keeps the plan offered next to the one-time price (the subscription
 * binds `subscription-price` and `plan-name` show it, and subscribing switches to it); `null` for a product without
 * plans.
 */
export type Purchase = { kind: 'one-time'; offeredPlanId: string | null } | { kind: 'subscription'; planId: string };
/** How the line is bought: on a plan only when the visitor subscribes and the variant is on that plan. */
type LinePurchase = { kind: 'one-time' } | { kind: 'subscription'; planId: string };
/** What the visitor chose, before it is checked against the product. */
interface ProductChoice {
  selected: Selection;
  purchase: Purchase;
  quantity: number;
}
export type ShowCondition =
  | 'in-stock'
  | 'out-of-stock'
  | 'backorder'
  | 'on-sale'
  | 'not-on-sale'
  | 'has-variants'
  | 'single-variant'
  | 'low-stock'
  | 'plenty-in-stock'
  | 'subscription-available'
  | 'subscription-unavailable'
  | 'subscription-only'
  | 'one-time-available'
  | 'subscription-selected'
  | 'one-time-selected'
  | 'has-savings';
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
  savings: { amount: Money | null; percentage: number };
  show: Record<ShowCondition, boolean>;
}
/** How the caller writes values as text. */
export interface Formatters {
  money: (money: Money | null) => string;
  percent: (percentage: number) => string;
}
/** What a bind writes; `null` and `undefined` clear it. */
type BindText = string | number | null | undefined;

const PERCENT = 100;

const timesQuantity = (money: Money, quantity: number): Money =>
  fromMinorUnits(toMinorUnits(money) * quantity, money.currencyCode);

export const selectionOf = (variant: ProductVariant): Selection =>
  Object.fromEntries(variant.selectedOptions.map((option) => [option.name, option.value]));

/** @returns The variant with exactly these option values. */
function findVariant(product: Product, selected: Selection): ProductVariant | null {
  return (
    product.variants.nodes.find((variant) =>
      variant.selectedOptions.every((option) => selected[option.name] === option.value),
    ) ?? null
  );
}

/**
 * @param name An option name.
 * @returns True when a variant for sale has this value and the other selected values.
 */
export function isValueAvailable(product: Product, selected: Selection, name: string, value: string): boolean {
  return product.variants.nodes.some(
    (variant) =>
      variant.availableForSale &&
      variant.selectedOptions.every((option) =>
        option.name === name ? option.value === value : selected[option.name] === option.value,
      ),
  );
}

/** @returns The plan subscribed on, or offered while buying once. */
export const purchasePlanId = (purchase: Purchase): string | null =>
  purchase.kind === 'subscription' ? purchase.planId : purchase.offeredPlanId;

/** @returns On the plan when subscribing and the variant is on it, else once. */
export function linePurchase(purchase: Purchase, variant: ProductVariant | null): LinePurchase {
  if (purchase.kind === 'subscription' && allocationFor(variant, purchase.planId)) return purchase;
  return { kind: 'one-time' };
}

/**
 * The purchase the visitor wants, made valid for the product and variant: one-time without plans, a subscription when
 * the product requires one, and a plan the variant is on when it is on any (else a plan of the product, for the binds
 * to offer).
 *
 * @param kind The way of buying the visitor asked for.
 * @param preferredPlanId The plan to keep when it is the product's: the visitor's last one.
 */
export function normalisePurchase(
  product: Product,
  variant: ProductVariant | null,
  kind: Purchase['kind'],
  preferredPlanId: string | null,
): Purchase {
  const plans = allPlans(product);
  const known = plans.find((plan) => plan.id === preferredPlanId) ?? plans[0];
  if (!known) return { kind: 'one-time', offeredPlanId: null };
  const onVariant = allocationFor(variant, known.id)
    ? known
    : (plans.find((plan) => allocationFor(variant, plan.id)) ?? known);
  if (product.requiresSellingPlan || kind === 'subscription') return { kind: 'subscription', planId: onVariant.id };
  return { kind: 'one-time', offeredPlanId: onVariant.id };
}

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
export function initialChoice(
  product: Product,
  { variant, sellingPlan, defaultPlan, defaultPurchase }: InitialChoiceOptions,
): Omit<ProductChoice, 'quantity'> {
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
    purchase: normalisePurchase(product, start, kind, offered?.id ?? null),
  };
}

function showConditions(
  variant: ProductVariant,
  lowStock: number,
  variantCount: number,
  sale: Pick<ProductView, 'line' | 'subscriptionAvailable' | 'compareAtPrice' | 'savings'>,
  requiresSellingPlan: boolean,
): Record<ShowCondition, boolean> {
  const stock = variant.quantityAvailable;
  const low = stock != null && stock > 0 && stock <= lowStock;
  const onSale = sale.compareAtPrice !== null;
  const onPlan = sale.line.kind === 'subscription';
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
    'subscription-selected': onPlan,
    'one-time-selected': !onPlan,
    'has-savings': onPlan ? sale.savings.percentage > 0 : onSale,
  };
}

/**
 * The view for the visitor's choice. A selection no variant has falls back to the first variant.
 *
 * @param lowStock `low-stock` at this many or fewer.
 * @returns `null` for a product without variants.
 */
export function productView(product: Product, choice: ProductChoice, lowStock: number): ProductView | null {
  const exact = findVariant(product, choice.selected);
  const variant = exact ?? product.variants.nodes[0];
  if (!variant) return null;
  const purchase = normalisePurchase(product, variant, choice.purchase.kind, purchasePlanId(choice.purchase));
  const planId = purchasePlanId(purchase);
  const plans = allPlans(product);
  const line = linePurchase(purchase, variant);
  const allocation = line.kind === 'subscription' ? allocationFor(variant, line.planId) : null;
  // The plan helpers fall back to the one-time price only without a variant, which `variant` rules out.
  const price = allocation ? (planPrice(variant, planId) ?? variant.price) : variant.price;
  const compareAt = allocation?.priceAdjustments[0]?.compareAtPrice ?? variant.compareAtPrice;
  const sale = {
    line,
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

/** The `tether-bind` values that follow the variant and purchase. Thunks, so only the binds on the page are computed. */
export function variantBindTexts(view: ProductView, format: Formatters): Map<string, () => BindText> {
  const { variant, plan, price, compareAtPrice, quantity } = view;
  const planId = purchasePlanId(view.purchase);
  // Prices for the quantity count one item when it is 0 (an optional bundle item).
  const forQuantity = (money: Money) => timesQuantity(money, Math.max(1, quantity));
  const checkoutCharge = () => {
    const charge = view.line.kind === 'subscription' ? (planCheckoutCharge(variant, planId) ?? price) : price;
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
  const texts: Record<string, () => BindText> = {
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
 * @param planId The list item's `tether-plan-value`.
 * @param plan The product's plan with that id.
 */
export function planBindTexts(
  variant: ProductVariant,
  planId: string,
  plan: PlanInGroup | undefined,
  format: Formatters,
): Map<string, () => BindText> {
  const adjustmentText = () => {
    const adjustment = planAdjustment(plan);
    if (!adjustment) return '';
    return adjustment.type === 'percentage' ? `${adjustment.value}%` : format.money(adjustment.value);
  };
  const texts: Record<string, () => BindText> = {
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
