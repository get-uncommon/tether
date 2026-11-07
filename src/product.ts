/**
 * ProductScope: everything inside [tether-product="<handle>"] binds to one Shopify product: options, variants,
 * quantity, subscriptions and add to cart. The scope holds the visitor's choice and the actions on it;
 * `product-state.ts` derives what the choice shows, `product-render.ts` and `variant-render.ts` write it, and
 * `product-events.ts` turns clicks and changes into actions.
 */
import { cfg } from './config.ts';
import {
  attr,
  sel,
  get,
  has,
  scoped,
  emit,
  setText,
  notifyLayoutChanged,
  watchImages,
  parseJSONAttr,
  attributesFromJson,
  isField,
  isInput,
} from './dom.ts';
import { Cart } from './cart.ts';
import { allPlans, allocationFor, findPlan, GID } from './selling-plans.ts';
import {
  initialChoice,
  linePurchase,
  normalisePurchase,
  productView,
  purchasePlanId,
  selectionOf,
} from './product-state.ts';
import { writeProduct } from './product-render.ts';
import { writeVariant } from './variant-render.ts';
import { bindProductEvents } from './product-events.ts';
import type { Product, ProductVariant } from './fragments.ts';
import type { ShopifyCart } from './cart/store.ts';
import type { PlanInGroup } from './selling-plans.ts';
import type { Purchase, Selection } from './product-state.ts';

/** What a scope adds to the cart. */
interface CartLineInput {
  merchandiseId: string;
  quantity: number;
  sellingPlanId?: string;
  attributes?: { key: string; value: string }[];
}

export const scopes = new WeakMap<Element, ProductScope>();

const productSelector = () => sel('product');

/**
 * Option names as written in the markup (the build's language), by product handle. In another language Shopify
 * translates them (Size → Größe), so markup names that aren't the product's are matched by position.
 */
const knownOptionNames = new Map<string, string[]>();

export function rememberOptionNames(products: readonly Pick<Product, 'handle' | 'options'>[]): void {
  products.forEach((product) => {
    if (!knownOptionNames.has(product.handle)) {
      knownOptionNames.set(
        product.handle,
        product.options.map((option) => option.name),
      );
    }
  });
}

/**
 * @param el A `tether-line-attribute` field.
 * @returns Its value for the cart line; `null` for an unchecked or empty field.
 */
function lineAttributeValue(el: HTMLElement): string | null {
  if (isInput(el) && el.type === 'checkbox') {
    if (!el.checked) return null;
    return el.value && el.value !== 'on' ? el.value : 'Yes';
  }
  if (isInput(el) && el.type === 'radio') return el.checked ? el.value : null;
  return (isField(el) && el.value) || null;
}

export class ProductScope {
  // `declare`: the constructor assigns every field, in this order, so the build defines none beforehand.
  declare readonly root: HTMLElement;
  declare product: Product;
  declare plans: PlanInGroup[];
  declare selected: Selection;
  /** How the visitor buys; `setPurchase` and `selectPlan` change it. */
  declare purchase: Purchase;
  declare variant: ProductVariant | null;
  declare quantity: number;

  constructor(root: HTMLElement, product: Product) {
    this.root = root;
    this.product = product;
    this.plans = allPlans(product);
    const params = new URLSearchParams(window.location.search);
    const choice = initialChoice(product, {
      variant: params.get('variant') || get(root, 'variant'),
      sellingPlan: params.get('selling_plan'),
      defaultPlan: get(root, 'default-plan'),
      defaultPurchase: get(root, 'default-purchase') || cfg.defaultPurchase,
    });
    this.selected = choice.selected;
    this.purchase = choice.purchase;
    this.variant = null;
    this.quantity = has(root, 'quantity') ? Math.max(0, parseInt(get(root, 'quantity') ?? '', 10) || 0) : 1;

    scopes.set(root, this);
    root.setAttribute(attr('state'), 'ready');
    root.removeAttribute(attr('error'));
    this.renderProduct();
    bindProductEvents(this);
    this.renderVariant();

    watchImages(root, 'product');
    notifyLayoutChanged('product');
    emit('product-ready', { product, scope: this }, root);
  }

  /** New data for the same product (a country switch). Keeps the visitor's choice. */
  update(product: Product): void {
    const variantId = this.variant?.id;
    this.product = product;
    this.plans = allPlans(product);
    const same = product.variants.nodes.find((variant) => variant.id === variantId);
    if (same) this.selected = selectionOf(same);
    this.root.setAttribute(attr('state'), 'ready');
    this.root.removeAttribute(attr('error'));
    this.renderProduct();
    this.renderVariant();
    notifyLayoutChanged('product');
    emit('product-updated', { product, scope: this }, this.root);
  }

  /** @returns Matches in this scope, including the root itself (a card link with tether-bind="link"). */
  $(selector: string): HTMLElement[] {
    const inner = scoped(this.root, selector, productSelector());
    return this.root.matches(selector) ? [this.root, ...inner] : inner;
  }

  /**
   * @param authored An option name in the markup.
   * @returns The product's option of that name, or at that position in the build's language.
   */
  optName(authored: string | null): string {
    if (!authored) return '';
    const { options } = this.product;
    if (options.some((option) => option.name === authored)) return authored;
    const index = (knownOptionNames.get(this.product.handle) ?? []).indexOf(authored);
    return options[index]?.name ?? authored;
  }

  get plan(): PlanInGroup | null {
    const planId = purchasePlanId(this.purchase);
    return this.plans.find((plan) => plan.id === planId) ?? null;
  }

  /** True when the current variant can be bought on a plan. */
  get subscriptionAvailable(): boolean {
    return this.plans.some((plan) => allocationFor(this.variant, plan.id));
  }

  /** True when the line is bought on a plan: subscribing, and the variant is on the plan. */
  get isSubscription(): boolean {
    return linePurchase(this.purchase, this.variant).kind === 'subscription';
  }

  /** @returns What would be added to the cart right now. */
  getLine(): CartLineInput | null {
    if (!this.variant) return null;
    const line: CartLineInput = { merchandiseId: this.variant.id, quantity: this.quantity };
    const bought = linePurchase(this.purchase, this.variant);
    if (bought.kind === 'subscription') line.sellingPlanId = bought.planId;
    const attributes = this.collectAttributes();
    if (attributes.length) line.attributes = attributes;
    return line;
  }

  /** @returns `tether-line-attributes` and the filled `tether-line-attribute` fields. */
  collectAttributes(): { key: string; value: string }[] {
    const fixed = attributesFromJson(parseJSONAttr(this.root, 'line-attributes'));
    const fields = this.$(sel('line-attribute')).flatMap((el) => {
      const value = lineAttributeValue(el);
      return value === null ? [] : [{ key: get(el, 'line-attribute') ?? '', value }];
    });
    return [...fixed, ...fields];
  }

  /**
   * Selects an option value. A combination no variant has moves to the closest variant with the value: the most other
   * choices kept, then one for sale.
   */
  select(name: string, value: string): void {
    if (this.selected[name] === value) return;
    const withValue = this.product.variants.nodes.filter((variant) =>
      variant.selectedOptions.some((option) => option.name === name && option.value === value),
    );
    const [firstWithValue] = withValue;
    // A value no variant has: nothing to select, the visitor's choice stays.
    if (!firstWithValue) return;
    const next = { ...this.selected, [name]: value };
    if (!withValue.some((variant) => variant.selectedOptions.every((option) => next[option.name] === option.value))) {
      const score = (variant: ProductVariant) => {
        const kept = variant.selectedOptions.filter(
          (option) => option.name !== name && this.selected[option.name] === option.value,
        ).length;
        // One kept choice outweighs being for sale.
        return kept * 2 + (variant.availableForSale ? 1 : 0);
      };
      const closest = withValue.reduce(
        (best, variant) => (score(variant) > score(best) ? variant : best),
        firstWithValue,
      );
      Object.assign(next, selectionOf(closest));
    }
    this.selected = next;
    this.renderVariant();
  }

  /** @param id A variant gid or numeric id. */
  selectVariant(id: string): void {
    const variant = this.product.variants.nodes.find((candidate) => candidate.id === GID.variant(id));
    if (!variant) return;
    this.selected = selectionOf(variant);
    this.renderVariant();
  }

  setPurchase(kind: Purchase['kind']): void {
    const next = normalisePurchase(this.product, this.variant, kind, purchasePlanId(this.purchase));
    // The product decides when the wanted kind isn't possible (no plans, or a plan required).
    if (next.kind === this.purchase.kind) return;
    this.purchase = next;
    this.renderVariant();
  }

  /** @param ref A plan id, numeric id, name or option value. */
  selectPlan(ref: string | null): void {
    const plan = findPlan(this.product, ref);
    if (!plan) return;
    this.purchase = { kind: 'subscription', planId: plan.id };
    this.renderVariant();
  }

  setQuantity(quantity: number | string): void {
    const minimum = has(this.root, 'quantity') ? 0 : 1;
    this.quantity = Math.max(minimum, parseInt(String(quantity), 10) || 0);
    this.$(sel('qty')).forEach((el) => {
      setText(el, this.quantity);
    });
    this.renderVariant();
  }

  /** @returns The cart after adding; `null` when the variant can't be added. */
  async addToCart(): Promise<ShopifyCart | null> {
    if (!this.variant?.availableForSale) return null;
    const line = this.getLine();
    if (!line || line.quantity < 1) return null;
    // What was added, even if the visitor picks another variant while the cart updates.
    const added = { product: this.product, variant: this.variant, line };
    const cart = await Cart.add(line);
    emit('product-added', added, this.root);
    return cart;
  }

  /** Learns the markup's option names when they are the product's, then writes the product. */
  renderProduct(): void {
    const { product } = this;
    if (!knownOptionNames.has(product.handle)) {
      const authored = this.$(`${sel('option-list')},select${sel('option')}`).map(
        (el) => get(el, 'option-list') || get(el, 'option'),
      );
      if (authored.some((name) => product.options.some((option) => option.name === name))) {
        rememberOptionNames([product]);
      }
    }
    writeProduct(this);
  }

  /** Derives the view of the current choice, keeps its variant, selection and purchase, and writes it. */
  renderVariant(): void {
    const view = productView(
      this.product,
      { selected: this.selected, purchase: this.purchase, quantity: this.quantity },
      cfg.lowStock,
    );
    if (!view) {
      this.variant = null;
      return;
    }
    this.variant = view.variant;
    this.selected = view.selected;
    this.purchase = view.purchase;
    writeVariant(this, view);
    emit(
      'variant-changed',
      {
        product: this.product,
        variant: view.variant,
        selected: { ...view.selected },
        purchase: view.purchase.kind,
        sellingPlanId: view.line.kind === 'subscription' ? view.line.planId : null,
      },
      this.root,
    );
  }
}

/**
 * A product scope as a site sees it (`Tether.getScope()`, the `product-ready` and `product-updated` events): its fields
 * change only through its methods, which keep the page in step with them.
 */
export type ReadonlyProductScope = Readonly<ProductScope>;
