/**
 * A product scope's clicks and changes: option and plan buttons, purchase toggles, quantity steppers, the selects and
 * add to cart. One delegated listener of each kind on the root, so cards a list re-renders need no new listeners.
 */
import { reportError } from './config.ts';
import { sel, get, emit, setText, busy } from './dom.ts';
import { addButtonLabel } from './variant-render.ts';
import type { ProductScope } from './product.ts';
import type { Purchase } from './product-state.ts';

const productSelector = () => sel('product');

const isField = (el: Element): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
  el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';

const isElement = (target: EventTarget | null): target is Element => target instanceof window.Element;

/**
 * @returns The nearest `selector` around `target` that belongs to the scope, not to a nested one. Typed as an HTML
 *   element, as `qsa` types its matches.
 */
function closestOwn(scope: ProductScope, target: Element, selector: string): HTMLElement | null {
  const el = target.closest<HTMLElement>(selector);
  return el?.closest(productSelector()) === scope.root ? el : null;
}

/** Adds to the cart with `aria-busy` on the button and `tether-adding-text` as its label meanwhile. */
function onAddClick(scope: ProductScope, button: HTMLElement): void {
  const { label, original } = addButtonLabel(button);
  const addingText = get(button, 'adding-text');
  busy(button, async () => {
    if (addingText) setText(label, addingText);
    try {
      await scope.addToCart();
    } catch (error) {
      reportError(error, 'add to cart failed');
      emit('error', { error, context: 'add-to-cart' }, scope.root);
    } finally {
      if (addingText) setText(label, original);
    }
  })
    .then(() => {
      // The mode-dependent labels (tether-subscribe-text, tether-soldout-text) wait for aria-busy to clear.
      scope.renderVariant();
    })
    .catch((error: unknown) => {
      reportError(error, 'add to cart render');
    });
}

function onClick(scope: ProductScope, event: Event, target: Element): void {
  const optionValue = closestOwn(scope, target, sel('option-value'));
  const optionList = optionValue?.closest(sel('option-list'));
  if (optionValue && optionList) {
    event.preventDefault();
    scope.select(scope.optName(get(optionList, 'option-list')), get(optionValue, 'option-value') ?? '');
    return;
  }
  const plan = closestOwn(scope, target, sel('plan-value'));
  if (plan) {
    event.preventDefault();
    scope.selectPlan(get(plan, 'plan-value'));
    return;
  }
  const purchase = closestOwn(scope, target, `${sel('purchase')}:not(select)`);
  if (purchase) {
    // A radio or checkbox input keeps its own click, so it shows checked.
    if (purchase.tagName !== 'INPUT') event.preventDefault();
    scope.setPurchase(purchaseKind(get(purchase, 'purchase')));
    return;
  }
  const plus = closestOwn(scope, target, sel('qty-plus'));
  const minus = plus ? null : closestOwn(scope, target, sel('qty-minus'));
  if (plus || minus) {
    event.preventDefault();
    scope.setQuantity(scope.quantity + (plus ? 1 : -1));
    return;
  }
  const add = closestOwn(scope, target, sel('add-to-cart'));
  if (add) {
    event.preventDefault();
    onAddClick(scope, add);
  }
}

/** @returns The kind a `tether-purchase` value asks for: `subscription`, else buying once. */
const purchaseKind = (value: string | null): Purchase['kind'] =>
  value === 'subscription' ? 'subscription' : 'one-time';

/** @param target A form field in the scope. */
function onChange(scope: ProductScope, target: Element): void {
  const value = isField(target) ? target.value : '';
  if (target.matches(`select${sel('option')}`)) {
    scope.select(scope.optName(get(target, 'option')), value);
  } else if (target.matches(`select${sel('variant-select')}`)) {
    scope.selectVariant(value);
  } else if (target.matches(`select${sel('plan')}`)) {
    if (value) scope.selectPlan(value);
    else scope.setPurchase('one-time');
  } else if (target.matches(`select${sel('purchase')}`)) {
    scope.setPurchase(purchaseKind(value));
  } else if (target.matches(sel('qty'))) {
    scope.setQuantity(value);
  }
}

export function bindProductEvents(scope: ProductScope): void {
  scope.root.addEventListener('click', (event) => {
    if (isElement(event.target)) onClick(scope, event, event.target);
  });
  scope.root.addEventListener('change', (event) => {
    const { target } = event;
    if (isElement(target) && target.closest(productSelector()) === scope.root) onChange(scope, target);
  });
}
