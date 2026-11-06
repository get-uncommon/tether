/**
 * The cart's markup controls, delegated from the document so they keep working across page swaps: open, close,
 * clear and checkout buttons, a line's +, - and remove buttons, its quantity input and plan select, the cart note, and
 * the keyboard of the open drawer (Escape closes it, Tab stays inside it).
 */
import { cfg, reportError } from '../config.js';
import { Cart, trapFocus } from '../cart.js';
import { sel, busy } from '../dom.js';

/** @returns {string} The attribute a rendered cart line carries its line id in. */
const lineKeyAttribute = () => `data-${cfg.prefix}-key`;

/**
 * @param {EventTarget | null} target
 * @returns {target is Element}
 */
const isElement = (target) => target instanceof window.Element;

/**
 * @param {Element} target
 * @returns {{ line: Element, id: string } | null} The rendered cart line `target` is in, with its line id.
 */
function lineOf(target) {
  const line = target.closest(`[${lineKeyAttribute()}]`);
  const id = line?.getAttribute(lineKeyAttribute());
  return line && id ? { line, id } : null;
}

/**
 * @param {Promise<unknown>} change
 * @param {string} context
 */
function reportFailure(change, context) {
  change.catch((/** @type {unknown} */ error) => {
    reportError(error, context);
  });
}

/**
 * A line's remove, + and - buttons.
 *
 * @param {MouseEvent} event
 * @param {Element} target
 */
function onLineClick(event, target) {
  const found = lineOf(target);
  if (!found?.line.closest(sel('cart-lines'))) return;
  const { line, id } = found;
  if (target.closest(sel('line-remove'))) {
    event.preventDefault();
    line.classList.add('is-busy');
    reportFailure(Cart.removeLine(id), 'cart line');
    return;
  }
  const delta = lineDelta(target);
  if (!delta || !Cart.lines.some((candidate) => candidate.id === id)) return;
  event.preventDefault();
  reportFailure(Cart.changeQuantity(id, delta), 'cart line');
}

/**
 * @param {Element} target
 * @returns {1 | -1 | 0} The quantity change of a + or - button, 0 for anything else.
 */
function lineDelta(target) {
  if (target.closest(sel('line-plus'))) return 1;
  if (target.closest(sel('line-minus'))) return -1;
  return 0;
}

/** @param {MouseEvent} event */
function onClick(event) {
  const { target } = event;
  if (!isElement(target)) return;
  if (target.closest(sel('cart-open'))) {
    event.preventDefault();
    Cart.toggle();
    return;
  }
  if (target.closest(sel('cart-close'))) {
    event.preventDefault();
    Cart.close();
    return;
  }
  const clear = target.closest(sel('cart-clear'));
  if (clear) {
    event.preventDefault();
    void busy(clear, () =>
      Cart.clear().catch((/** @type {unknown} */ error) => {
        reportError(error, 'cart clear');
      }),
    );
    return;
  }
  const checkout = target.closest(sel('checkout'));
  if (checkout) {
    event.preventDefault();
    void busy(checkout, () => Cart.checkout());
    return;
  }
  onLineClick(event, target);
}

/**
 * The line shows `is-busy` and `aria-busy` until Shopify has answered; the next render removes them.
 *
 * @param {Element} line
 * @param {Promise<unknown>} change
 * @param {string} context
 */
function showLineBusy(line, change, context) {
  line.classList.add('is-busy');
  line.setAttribute('aria-busy', 'true');
  reportFailure(change, context);
}

/** @param {Event} event */
function onChange(event) {
  const { target } = event;
  if (!isElement(target)) return;
  const found = lineOf(target);
  if (found && target instanceof window.HTMLInputElement && target.matches(sel('line', 'quantity'))) {
    showLineBusy(found.line, Cart.updateLine(found.id, parseInt(target.value, 10) || 0), 'cart line');
  } else if (found && target instanceof window.HTMLSelectElement && target.matches(sel('line-plan'))) {
    showLineBusy(found.line, Cart.updateLine(found.id, { sellingPlanId: target.value || null }), 'cart line plan');
  } else if (hasValue(target) && target.matches(sel('cart-note'))) {
    reportFailure(Cart.setNote(target.value), 'cart note');
  }
}

/**
 * @param {Element} target
 * @returns {target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement}
 */
const hasValue = (target) =>
  target instanceof window.HTMLInputElement ||
  target instanceof window.HTMLTextAreaElement ||
  target instanceof window.HTMLSelectElement;

/** @param {KeyboardEvent} event */
function onKeydown(event) {
  if (!Cart.isOpen()) return;
  if (event.key === 'Escape') {
    Cart.close();
    return;
  }
  trapFocus(event);
}

/** Binds the document-wide listeners, once per page load of the script. */
export function bindCartControls() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKeydown);
}
