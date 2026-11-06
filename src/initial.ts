/**
 * What the browser script shows first for a product, as plain data, so a server renders the same and nothing flashes
 * when Tether takes over. Public as `initialState()` of `@occluze/tether/server`; the rules are `product-state.ts`'s,
 * the ones the browser scope uses.
 */
import { DEFAULTS } from './config.ts';
import { TetherError } from './client.ts';
import { initialChoice, isValueAvailable, productView } from './product-state.ts';
import { allPlans, allocationFor, planPrice, planSavings } from './selling-plans.ts';
import type { Money } from './shopify-values.ts';
import type { Product, ProductVariant } from './fragments.ts';
import type { PlanInGroup } from './selling-plans.ts';
import type { Selection, ShowCondition } from './product-state.ts';

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
export function initialState(product: Product, options?: InitialOptions): InitialState;
/** @returns `null` without a product. */
export function initialState(product: Product | null | undefined, options?: InitialOptions): InitialState | null;
export function initialState(product: Product | null | undefined, options: InitialOptions = {}): InitialState | null {
  if (!product) return null;
  const { variant, sellingPlan, defaultPurchase = DEFAULTS.defaultPurchase, lowStock = DEFAULTS.lowStock } = options;
  const choice = initialChoice(product, { variant, sellingPlan, defaultPurchase });
  const view = productView(product, { ...choice, quantity: 1 }, lowStock);
  if (!view) throw new TetherError(`Product ${product.handle} has no variants`);
  const { selected, line } = view;
  const isUnavailable = (name: string, value: string) => !isValueAvailable(product, selected, name, value);
  return {
    variant: view.variant,
    selected,
    purchase: view.purchase.kind,
    plan: line.kind === 'subscription' ? view.plan : null,
    plans: allPlans(product).map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: planPrice(view.variant, plan.id),
      savings: planSavings(view.variant, plan.id).percentage,
      selected: line.kind === 'subscription' && plan.id === line.planId,
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
