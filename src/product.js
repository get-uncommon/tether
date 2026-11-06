/**
 * ProductScope: everything inside [tether-product="<handle>"] binds to one Shopify product: options, variants,
 * quantity, subscriptions and add to cart. The scope holds the visitor's choice and the actions on it;
 * `product-state.js` derives what the choice shows, `product-render.js` and `variant-render.js` write it, and
 * `product-events.js` turns clicks and changes into actions.
 */
import { cfg } from './config.js';
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
} from './dom.js';
import { Cart } from './cart.js';
import { allPlans, allocationFor, findPlan, GID } from './selling-plans.js';
import {
  initialChoice,
  linePurchase,
  normalisePurchase,
  productView,
  purchasePlanId,
  selectionOf,
} from './product-state.js';
import { writeProduct } from './product-render.js';
import { writeVariant } from './variant-render.js';
import { bindProductEvents } from './product-events.js';
/** @import { Product, ProductVariant } from './fragments.js' */
/** @import { PlanInGroup } from './selling-plans.js' */
/** @import { Purchase, Selection } from './product-state.js' */

/**
 * @typedef {object} CartLineInput What a scope adds to the cart.
 * @property {string} merchandiseId
 * @property {number} quantity
 * @property {string} [sellingPlanId]
 * @property {{ key: string, value: string }[]} [attributes]
 */

/** @type {WeakMap<Element, ProductScope>} */
export const scopes = new WeakMap();

const productSelector = () => sel('product');

/**
 * Option names as written in the markup (the build's language), by product handle. In another language Shopify
 * translates them (Size → Größe), so markup names that aren't the product's are matched by position.
 *
 * @type {Map<string, string[]>}
 */
const knownOptionNames = new Map();

/** @param {readonly Pick<Product, 'handle' | 'options'>[]} products */
export function rememberOptionNames(products) {
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
 * @param {Element} el
 * @returns {el is HTMLInputElement}
 */
const isInput = (el) => el.tagName === 'INPUT';

/**
 * @param {Element} el
 * @returns {el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement}
 */
const isField = (el) => el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';

/**
 * @param {HTMLElement} el A `tether-line-attribute` field.
 * @returns {string | null} Its value for the cart line; `null` for an unchecked or empty field.
 */
function lineAttributeValue(el) {
  if (isInput(el) && el.type === 'checkbox') {
    if (!el.checked) return null;
    return el.value && el.value !== 'on' ? el.value : 'Yes';
  }
  if (isInput(el) && el.type === 'radio') return el.checked ? el.value : null;
  return (isField(el) && el.value) || null;
}

export class ProductScope {
  /**
   * @param {HTMLElement} root
   * @param {Product} product
   */
  constructor(root, product) {
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
    /** @type {Selection} */
    this.selected = choice.selected;
    /** @type {Purchase} */
    this.purchaseChoice = choice.purchase;
    /** @type {ProductVariant | null} */
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

  /**
   * New data for the same product (a country switch). Keeps the visitor's choice.
   *
   * @param {Product} product
   */
  update(product) {
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

  /**
   * @param {string} selector
   * @returns {HTMLElement[]} Matches in this scope, including the root itself (a card link with tether-bind="link").
   */
  $(selector) {
    const inner = scoped(this.root, selector, productSelector());
    return this.root.matches(selector) ? [this.root, ...inner] : inner;
  }

  /**
   * @param {string | null} authored An option name in the markup.
   * @returns {string} The product's option of that name, or at that position in the build's language.
   */
  optName(authored) {
    if (!authored) return '';
    const { options } = this.product;
    if (options.some((option) => option.name === authored)) return authored;
    const index = (knownOptionNames.get(this.product.handle) ?? []).indexOf(authored);
    return options[index]?.name ?? authored;
  }

  /** @returns {'one-time' | 'subscription'} */
  get purchase() {
    return this.purchaseChoice.kind;
  }

  /** @param {string} kind */
  set purchase(kind) {
    const wanted = kind === 'subscription' ? 'subscription' : 'one-time';
    this.purchaseChoice = normalisePurchase(this.product, this.variant, wanted, this.planId);
  }

  /** @returns {string | null} The plan bought on, or offered while buying once. */
  get planId() {
    return purchasePlanId(this.purchaseChoice);
  }

  /** @param {string | null} planId */
  set planId(planId) {
    this.purchaseChoice = normalisePurchase(this.product, this.variant, this.purchase, planId);
  }

  /** @returns {PlanInGroup | null} */
  get plan() {
    return this.plans.find((plan) => plan.id === this.planId) ?? null;
  }

  /** True when the current variant can be bought on a plan. */
  get subscriptionAvailable() {
    return this.plans.some((plan) => allocationFor(this.variant, plan.id));
  }

  /** True when the line is bought on a plan: subscribing, and the variant is on the plan. */
  get isSubscription() {
    return linePurchase(this.purchaseChoice, this.variant).kind === 'subscription';
  }

  /** @returns {CartLineInput | null} What would be added to the cart right now. */
  getLine() {
    if (!this.variant) return null;
    /** @type {CartLineInput} */
    const line = { merchandiseId: this.variant.id, quantity: this.quantity };
    const bought = linePurchase(this.purchaseChoice, this.variant);
    if (bought.kind === 'subscription') line.sellingPlanId = bought.planId;
    const attributes = this.collectAttributes();
    if (attributes.length) line.attributes = attributes;
    return line;
  }

  /** @returns {{ key: string, value: string }[]} `tether-line-attributes` and the filled `tether-line-attribute` fields. */
  collectAttributes() {
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
   *
   * @param {string} name
   * @param {string} value
   */
  select(name, value) {
    if (this.selected[name] === value) return;
    const withValue = this.product.variants.nodes.filter((variant) =>
      variant.selectedOptions.some((option) => option.name === name && option.value === value),
    );
    const [firstWithValue] = withValue;
    // A value no variant has: nothing to select, the visitor's choice stays.
    if (!firstWithValue) return;
    const next = { ...this.selected, [name]: value };
    if (!withValue.some((variant) => variant.selectedOptions.every((option) => next[option.name] === option.value))) {
      const score = (/** @type {ProductVariant} */ variant) => {
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

  /** @param {string} id A variant gid or numeric id. */
  selectVariant(id) {
    const variant = this.product.variants.nodes.find((candidate) => candidate.id === GID.variant(id));
    if (!variant) return;
    this.selected = selectionOf(variant);
    this.renderVariant();
  }

  /** @param {string | null} mode `subscription`, else buying once. */
  setPurchase(mode) {
    const kind = mode === 'subscription' ? 'subscription' : 'one-time';
    const next = normalisePurchase(this.product, this.variant, kind, this.planId);
    // The product decides when the wanted kind isn't possible (no plans, or a plan required).
    if (next.kind === this.purchase) return;
    this.purchaseChoice = next;
    this.renderVariant();
  }

  /** @param {string | null} ref A plan id, numeric id, name or option value. */
  selectPlan(ref) {
    const plan = findPlan(this.product, ref);
    if (!plan) return;
    this.purchaseChoice = { kind: 'subscription', planId: plan.id };
    this.renderVariant();
  }

  /** @param {number | string} quantity */
  setQuantity(quantity) {
    const minimum = has(this.root, 'quantity') ? 0 : 1;
    this.quantity = Math.max(minimum, parseInt(String(quantity), 10) || 0);
    this.$(sel('qty')).forEach((el) => {
      setText(el, this.quantity);
    });
    this.renderVariant();
  }

  /** @returns {Promise<unknown>} The cart after adding; `null` when the variant can't be added. */
  async addToCart() {
    if (!this.variant?.availableForSale) return null;
    const line = this.getLine();
    if (!line || line.quantity < 1) return null;
    const cart = await Cart.add(line);
    emit('product-added', { product: this.product, variant: this.variant, line }, this.root);
    return cart;
  }

  /** Learns the markup's option names when they are the product's, then writes the product. */
  renderProduct() {
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
  renderVariant() {
    const view = productView(
      this.product,
      { selected: this.selected, purchase: this.purchaseChoice, quantity: this.quantity },
      cfg.lowStock,
    );
    if (!view) {
      this.variant = null;
      return;
    }
    this.variant = view.variant;
    this.selected = view.selected;
    this.purchaseChoice = view.purchase;
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
