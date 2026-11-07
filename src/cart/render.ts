/**
 * Shows the cart everywhere on the page: counts, totals, `tether-show="cart-*"` conditions, the note, the discount
 * codes and the `[tether-cart-lines]` repeaters. It renders what it is given (a `CartView`) and holds no state, so
 * every render shows the cart as the store has it at that moment.
 */
import { cfg, reportFailure } from '../config.ts';
import { getProduct } from '../loader.ts';
import { allPlans } from '../selling-plans.ts';
import { isSelect } from '../product-render.ts';
import { isGreaterAmount } from '../amounts.ts';
import {
  attr,
  sel,
  get,
  qsa,
  formatMoney,
  setText,
  setTextTracked,
  setImage,
  show,
  repeat,
  repeatKeyed,
  productUrl,
  notifyLayoutChanged,
} from '../dom.ts';
import { syncDrawerAria } from './drawer.ts';
import type { CartWarning } from '../config.ts';
import type { Product } from '../fragments.ts';
import type { ShopifyCart, ShopifyCartLine, PendingQuantity } from './store.ts';

/** What a render shows. */
interface CartView {
  cart: ShopifyCart | null;
  warnings: readonly CartWarning[];
  /** Line id → the quantity quick clicks asked for. */
  pending: ReadonlyMap<string, PendingQuantity>;
  /** The last load or change failed (`tether-show="cart-error"`). */
  failed: boolean;
}

/** Shopify's title of a variant of a product without options. */
const DEFAULT_TITLE = 'Default Title';

/** @returns The quantity to show: the one asked for while an update is on its way. */
export const quantityOf = (line: ShopifyCartLine, pending: ReadonlyMap<string, PendingQuantity>): number =>
  pending.get(line.id)?.quantity ?? line.quantity;

const numericId = (gid: string) => gid.split('/').pop() ?? gid;

/** @returns The product page, with the line's variant and plan selected. */
function lineUrl(line: ShopifyCartLine): string | null {
  const variant = line.merchandise;
  const base = productUrl(variant.product.handle, variant.product.id);
  if (!base) return null;
  const query = new URLSearchParams();
  query.set('variant', numericId(variant.id));
  const planId = line.sellingPlanAllocation?.sellingPlan.id;
  if (planId) query.set('selling_plan', numericId(planId));
  return `${base}${base.includes('?') ? '&' : '?'}${query.toString()}`;
}

type LineText = (line: ShopifyCartLine, view: CartView) => string | number;

const productTitle: LineText = (line) => line.merchandise.product.title;

/** The text of each `tether-line` key. */
const LINE_TEXT: Record<string, LineText> = {
  title: productTitle,
  'product-title': productTitle,
  'variant-title': (line) => (line.merchandise.title === DEFAULT_TITLE ? '' : line.merchandise.title),
  options: (line) =>
    line.merchandise.selectedOptions
      .filter((option) => option.value !== DEFAULT_TITLE)
      .map((option) => `${option.name}: ${option.value}`)
      .join(', '),
  vendor: (line) => line.merchandise.product.vendor,
  sku: (line) => line.merchandise.sku ?? '',
  price: (line) => formatMoney(line.cost.amountPerQuantity),
  'compare-at-price': (line) => formatMoney(line.cost.compareAtAmountPerQuantity ?? line.merchandise.compareAtPrice),
  'line-total': (line) => formatMoney(line.cost.totalAmount),
  'line-subtotal': (line) => formatMoney(line.cost.subtotalAmount),
  quantity: (line, view) => quantityOf(line, view.pending),
  plan: (line) => line.sellingPlanAllocation?.sellingPlan.name ?? '',
  'plan-description': (line) => line.sellingPlanAllocation?.sellingPlan.description ?? '',
  components: (line) =>
    (line.lineComponents ?? [])
      .map((component) => `${component.quantity} × ${component.merchandise.product.title}`)
      .join(', '),
};

const ATTRIBUTE_KEY = 'attribute:';

/**
 * @param key The `tether-line` value.
 * @returns The text for `key`, `undefined` for a key Tether doesn't know.
 */
function lineValue(line: ShopifyCartLine, key: string, view: CartView): string | number | undefined {
  if (Object.hasOwn(LINE_TEXT, key)) return LINE_TEXT[key]?.(line, view);
  if (!key.startsWith(ATTRIBUTE_KEY)) return undefined;
  const name = key.slice(ATTRIBUTE_KEY.length);
  return line.attributes.find((attribute) => attribute.key === name)?.value ?? '';
}

/**
 * Fills a `<select tether-line-plan>` with the product's plans (and one-time purchase, when the product allows it and
 * the select isn't `subscription-only`), keeping the options when they haven't changed.
 */
function fillPlanSelect(select: HTMLSelectElement, line: ShopifyCartLine, product: Product) {
  const plans = allPlans(product);
  const allowOneTime = !product.requiresSellingPlan && get(select, 'line-plan') !== 'subscription-only';
  const oneTime = { value: '', label: select.getAttribute(attr('one-time-label')) || 'One-time purchase' };
  const choices = [...(allowOneTime ? [oneTime] : []), ...plans.map((plan) => ({ value: plan.id, label: plan.name }))];
  const signature = choices.map((choice) => choice.value).join('|');
  if (select.dataset['tetherSig'] !== signature) {
    select.replaceChildren(
      ...choices.map((choice) => {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        return option;
      }),
    );
    select.dataset['tetherSig'] = signature;
  }
  select.value = line.sellingPlanAllocation?.sellingPlan.id ?? '';
  show(select, plans.length > 0);
}

function renderLineState(node: HTMLElement, line: ShopifyCartLine, view: CartView) {
  const isSubscription = Boolean(line.sellingPlanAllocation);
  node.classList.toggle('is-subscription', isSubscription);
  // Shopify's note about this line, such as less stock than asked.
  const warning = view.warnings.find((candidate) => candidate.target === line.id);
  node.classList.toggle('is-warning', Boolean(warning));
  const pending = view.pending.has(line.id);
  node.classList.toggle('is-busy', pending);
  if (pending) node.setAttribute('aria-busy', 'true');
  else node.removeAttribute('aria-busy');
  qsa(node, sel('line', 'warning')).forEach((el) => {
    setTextTracked(el, warning?.message ?? '');
  });
  const conditions = new Map([
    ['subscription', isSubscription],
    ['one-time', !isSubscription],
    ['on-sale', isGreaterAmount(line.cost.compareAtAmountPerQuantity?.amount, line.cost.amountPerQuantity.amount)],
    ['has-components', (line.lineComponents ?? []).length > 0],
    ['warning', Boolean(warning)],
  ]);
  qsa(node, sel('line-show')).forEach((el) => {
    const key = get(el, 'line-show');
    const visible = key === null ? undefined : conditions.get(key);
    if (visible !== undefined) show(el, visible);
  });
}

function renderLine(node: HTMLElement, line: ShopifyCartLine, view: CartView) {
  const variant = line.merchandise;
  node.setAttribute(attr('line-id'), line.id);
  qsa(node, sel('line')).forEach((el) => {
    const key = get(el, 'line') ?? '';
    if (key === 'image') {
      setImage(el, variant.image?.url ?? variant.product.featuredImage?.url, variant.product.title);
      return;
    }
    if (key === 'url') {
      const url = lineUrl(line);
      if (url) el.setAttribute('href', url);
      return;
    }
    const value = lineValue(line, key, view);
    if (value !== undefined) setTextTracked(el, value);
  });
  renderLineState(node, line, view);
  const planSelects = qsa(node, sel('line-plan')).filter(isSelect);
  planSelects.forEach((select) => {
    reportFailure(
      getProduct(variant.product.handle).then((product) => {
        fillPlanSelect(select, line, product);
      }),
      'line plan options',
    );
  });
}

function renderConditions(cart: ShopifyCart | null, view: CartView) {
  const count = cart?.totalQuantity ?? 0;
  const hasSubscription = (cart?.lines.nodes ?? []).some((line) => line.sellingPlanAllocation);
  const conditions = new Map([
    ['cart-empty', count === 0],
    ['cart-filled', count > 0],
    ['cart-has-subscription', hasSubscription],
    ['cart-no-subscription', !hasSubscription],
    ['cart-has-discount', (cart?.discountCodes ?? []).some((code) => code.applicable)],
    ['cart-error', view.failed],
    ['cart-warning', view.warnings.length > 0],
  ]);
  qsa(document, sel('show')).forEach((el) => {
    const key = get(el, 'show');
    const visible = key === null ? undefined : conditions.get(key);
    if (visible === undefined || el.closest(sel('product'))) return;
    show(el, visible);
  });
  qsa(document, sel('checkout')).forEach((el) => {
    el.classList.toggle('is-disabled', !count);
    el.setAttribute('aria-disabled', String(!count));
  });
}

function renderFields(cart: ShopifyCart | null) {
  qsa(document, `textarea${sel('cart-note')},input${sel('cart-note')}`).forEach((el) => {
    // The visitor may be typing in it.
    if (document.activeElement !== el) setText(el, cart?.note ?? '');
  });
  qsa(document, sel('cart-discounts')).forEach((container) => {
    repeat(container, cart?.discountCodes ?? [], (node, discount) => {
      node.setAttribute(attr('discount-code'), discount.code);
      const target = node.querySelector(sel('discount', 'code')) ?? (node.firstElementChild ? null : node);
      if (target) setText(target, discount.code);
      node.classList.toggle('is-inapplicable', !discount.applicable);
    });
  });
}

export function renderCart(view: CartView): void {
  const { cart } = view;
  const money = (key: 'subtotalAmount' | 'totalAmount' | 'checkoutChargeAmount') =>
    cart ? formatMoney(cart.cost[key]) : '';

  syncDrawerAria();
  qsa(document, sel('cart-count')).forEach((el) => {
    setTextTracked(el, cart?.totalQuantity ?? 0);
  });
  qsa(document, sel('cart-subtotal')).forEach((el) => {
    setTextTracked(el, money('subtotalAmount'));
  });
  qsa(document, sel('cart-total')).forEach((el) => {
    setTextTracked(el, money('totalAmount'));
  });
  qsa(document, sel('cart-checkout-charge')).forEach((el) => {
    setTextTracked(el, money('checkoutChargeAmount'));
  });
  renderConditions(cart, view);
  qsa(document, sel('cart-warning')).forEach((el) => {
    // A live region, so screen readers announce Shopify's message; the site's own role stays.
    if (!el.hasAttribute('role')) el.setAttribute('role', 'status');
    setTextTracked(el, [...new Set(view.warnings.map((warning) => warning.message))].join(' '));
  });
  renderFields(cart);
  qsa(document, sel('cart-lines')).forEach((container) => {
    repeatKeyed(
      container,
      cart?.lines.nodes ?? [],
      (line) => line.id,
      (node, line) => {
        renderLine(node, line, view);
      },
      { onEnter: cfg.onLineEnter, onLeave: cfg.onLineLeave },
    );
  });
  if (cart) notifyLayoutChanged('cart');
}

/** Shows the count a saved cart had on the last page in the cart counts the page left at 0, until it has loaded. */
export function showSavedCount(count: number): void {
  qsa(document, sel('cart-count')).forEach((el) => {
    if (/^\s*0?\s*$/.test(el.textContent)) el.textContent = String(count);
  });
}
