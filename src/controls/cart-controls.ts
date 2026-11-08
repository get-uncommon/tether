/**
 * The cart's markup controls, delegated from the document so they keep working across page swaps: open, close,
 * clear and checkout buttons, a line's +, - and remove buttons, its quantity input and plan select, the cart note, and
 * the keyboard of the open drawer (Escape closes it, Tab stays inside it).
 */
import { cfg, reportError, reportFailure } from '../config.ts';
import { Cart, trapFocus } from '../cart.ts';
import { sel, busy, INTEGER_TEXT, isElement, isField, isInput } from '../dom.ts';
import { isSelect } from '../product-render.ts';

/** @returns The attribute a rendered cart line carries its line id in. */
const lineKeyAttribute = (): string => `data-${cfg.prefix}-key`;

/** @returns The rendered cart line `target` is in, with its line id. */
function lineOf(target: Element): { line: Element; id: string } | null {
  const line = target.closest(`[${lineKeyAttribute()}]`);
  const id = line?.getAttribute(lineKeyAttribute());
  return line && id ? { line, id } : null;
}

/** A line's remove, + and - buttons. */
function onLineClick(event: MouseEvent, target: Element): void {
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

/** @returns The quantity change of a + or - button, 0 for anything else. */
function lineDelta(target: Element): 1 | -1 | 0 {
  if (target.closest(sel('line-plus'))) return 1;
  if (target.closest(sel('line-minus'))) return -1;
  return 0;
}

function onClick(event: MouseEvent): void {
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
      Cart.clear().catch((error: unknown) => {
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

/** The line shows `is-busy` and `aria-busy` until Shopify has answered; the next render removes them. */
function showLineBusy(line: Element, change: Promise<unknown>, context: string): void {
  line.classList.add('is-busy');
  line.setAttribute('aria-busy', 'true');
  reportFailure(change, context);
}

/**
 * A typed quantity; 0 or less removes the line. A field left empty or without a whole number, as while the visitor
 * replaces the number, gets the line's quantity back and changes nothing.
 */
function onQuantityInput(input: HTMLInputElement, { line, id }: { line: Element; id: string }): void {
  const typed = input.value.trim();
  if (INTEGER_TEXT.test(typed)) {
    showLineBusy(line, Cart.updateLine(id, Number(typed)), 'cart line');
    return;
  }
  const current = Cart.lines.find((candidate) => candidate.id === id);
  if (current) input.value = String(Cart.quantityOf(current));
}

function onChange(event: Event): void {
  const { target } = event;
  if (!isElement(target)) return;
  const found = lineOf(target);
  if (found && isInput(target) && target.matches(sel('line', 'quantity'))) {
    onQuantityInput(target, found);
  } else if (found && isSelect(target) && target.matches(sel('line-plan'))) {
    showLineBusy(found.line, Cart.updateLine(found.id, { sellingPlanId: target.value || null }), 'cart line plan');
  } else if (isField(target) && target.matches(sel('cart-note'))) {
    reportFailure(Cart.setNote(target.value), 'cart note');
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!Cart.isOpen()) return;
  if (event.key === 'Escape') {
    Cart.close();
    return;
  }
  trapFocus(event);
}

/** Binds the document-wide listeners, once per page load of the script. */
export function bindCartControls(): void {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKeydown);
}
