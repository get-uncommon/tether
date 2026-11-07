/**
 * The DOM writes of a product scope that follow the visitor's choice, on every change: `product-state.ts`'s view as
 * text, selected and unavailable states, `tether-show` conditions and the add-to-cart buttons.
 */
import {
  attr,
  sel,
  get,
  qsa,
  formatMoney,
  formatPercent,
  setText,
  setImage,
  setSelected,
  setUnavailable,
  show,
} from './dom.ts';
import { STATUS_KEYS, ownedBy } from './status.ts';
import { allocationFor } from './selling-plans.ts';
import { isValueAvailable, planBindTexts, variantBindTexts } from './product-state.ts';
import { isSelect, selectsIn } from './product-render.ts';
import type { Formatters, ProductView } from './product-state.ts';
import type { RenderScope } from './product-render.ts';

const FORMAT: Formatters = { money: formatMoney, percent: formatPercent };

const isInput = (el: Element): el is HTMLInputElement => el.tagName === 'INPUT';

/**
 * The element of an add-to-cart button that holds its label, with the label as written kept in
 * `data-tether-label`, so mode-dependent texts (`tether-subscribe-text`, `tether-soldout-text`) can be undone.
 */
export function addButtonLabel(button: HTMLElement): { label: HTMLElement; original: string } {
  const label = qsa(button, sel('add-label'))[0] ?? button;
  const original = label.dataset['tetherLabel'] ?? (isInput(label) ? label.value : label.textContent);
  label.dataset['tetherLabel'] = original;
  return { label, original };
}

function renderOptionStates(scope: RenderScope, view: ProductView): void {
  const { product } = scope;
  const selectedValue = (authored: string | null) => view.selected[scope.optName(authored)] ?? '';
  scope.$(sel('option-selected')).forEach((el) => {
    setText(el, selectedValue(get(el, 'option-selected')));
  });
  scope.$(sel('option-list')).forEach((container) => {
    const name = scope.optName(get(container, 'option-list'));
    qsa(container, sel('option-value')).forEach((node) => {
      const value = get(node, 'option-value') ?? '';
      setSelected(node, view.selected[name] === value);
      const unavailable = !isValueAvailable(product, view.selected, name, value);
      setUnavailable(node, unavailable);
      node.setAttribute('data-unavailable', unavailable ? 'true' : 'false');
    });
  });
  selectsIn(scope, sel('option')).forEach((select) => {
    select.value = selectedValue(get(select, 'option'));
  });
  selectsIn(scope, sel('variant-select')).forEach((select) => {
    select.value = view.variant.id;
  });
}

/**
 * The purchase toggles and the plan list and select.
 */
function renderPurchaseStates(scope: RenderScope, view: ProductView): void {
  const { variant, purchase, line } = view;
  scope.$(sel('purchase')).forEach((el) => {
    if (isSelect(el)) {
      el.value = purchase.kind;
      return;
    }
    const mode = get(el, 'purchase');
    setSelected(el, mode === purchase.kind);
    setUnavailable(el, mode === 'subscription' ? !view.subscriptionAvailable : scope.product.requiresSellingPlan);
  });
  scope.$(sel('plan-value')).forEach((node) => {
    const planId = get(node, 'plan-value') ?? '';
    setSelected(node, line.kind === 'subscription' && planId === line.planId);
    setUnavailable(node, !allocationFor(variant, planId));
    const plan = scope.plans.find((candidate) => candidate.id === planId);
    const texts = planBindTexts(variant, planId, plan, FORMAT);
    qsa(node, sel('plan-bind')).forEach((el) => {
      const text = texts.get(get(el, 'plan-bind') ?? '');
      if (text) setText(el, text());
    });
  });
  selectsIn(scope, sel('plan')).forEach((select) => {
    select.value = line.kind === 'subscription' ? line.planId : '';
  });
}

/**
 * The `tether-show` conditions, with the scope's own status: a product scope that renders is ready.
 */
function renderConditions(scope: RenderScope, view: ProductView): void {
  const conditions = new Map<string, boolean>(Object.entries(view.show));
  STATUS_KEYS.forEach((status) => conditions.set(status, status === 'ready'));
  scope.$(sel('show')).forEach((el) => {
    const key = get(el, 'show') ?? '';
    const visible = conditions.get(key);
    if (visible === undefined) return;
    // State blocks of a list nested in this product belong to that list.
    if (STATUS_KEYS.some((status) => status === key) && !ownedBy(el, scope.root)) return;
    show(el, visible);
  });
}

function renderAddButtons(scope: RenderScope, view: ProductView): void {
  const disabled = !view.variant.availableForSale;
  scope.$(sel('add-to-cart')).forEach((button) => {
    button.classList.toggle('is-disabled', disabled);
    button.setAttribute('aria-disabled', String(disabled));
    // A <button> or <input> is disabled; a link or div carries only aria-disabled.
    if ('disabled' in button) button.disabled = disabled;
    const soldOutText = get(button, 'soldout-text');
    const subscribeText = get(button, 'subscribe-text');
    if (!soldOutText && !subscribeText) return;
    const { label, original } = addButtonLabel(button);
    let text = original;
    if (view.line.kind === 'subscription' && subscribeText) text = subscribeText;
    if (disabled && soldOutText) text = soldOutText;
    if (button.getAttribute('aria-busy') !== 'true') setText(label, text);
  });
}

/**
 * Writes what follows the variant and purchase.
 */
export function writeVariant(scope: RenderScope, view: ProductView): void {
  const { variant } = view;
  const { product } = scope;
  const texts = variantBindTexts(view, FORMAT);
  scope.$(sel('bind')).forEach((el) => {
    const key = get(el, 'bind') ?? '';
    if (key === 'variant-image') {
      setImage(el, variant.image?.url || product.featuredImage?.url, variant.image?.altText || product.title);
      return;
    }
    const text = texts.get(key);
    if (text) setText(el, text());
  });
  renderOptionStates(scope, view);
  renderPurchaseStates(scope, view);
  renderConditions(scope, view);
  scope.root.classList.toggle('is-subscription', view.line.kind === 'subscription');
  scope.root.setAttribute(attr('purchase-mode'), view.line.kind);
  renderAddButtons(scope, view);
}
