/**
 * The discount code form (`tether-discount-form` with `tether-discount-input`) and the remove buttons of applied codes
 * (`tether-discount-remove` inside `tether-discount-code`), delegated from the document. A code Shopify refuses marks
 * the form `is-invalid` (and the input `aria-invalid`) until the visitor types again.
 */
import { reportError } from '../config.ts';
import { TetherError } from '../client.ts';
import { Cart } from '../cart.ts';
import { attr, sel, busy, emit } from '../dom.ts';

const isElement = (target: EventTarget | null): target is Element => target instanceof window.Element;

function codeInputOf(form: Element): HTMLInputElement | null {
  const input = form.querySelector(sel('discount-input')) ?? form.querySelector('input');
  return input instanceof window.HTMLInputElement ? input : null;
}

function markInvalid(form: Element, input: HTMLInputElement | null, invalid: boolean): void {
  form.classList.toggle('is-invalid', invalid);
  if (invalid) input?.setAttribute('aria-invalid', 'true');
  else input?.removeAttribute('aria-invalid');
}

async function applyCode(form: Element, input: HTMLInputElement | null, code: string): Promise<void> {
  try {
    await Cart.applyDiscount(code);
    markInvalid(form, input, false);
    emit('discount-applied', { code }, form);
    if (input) input.value = '';
  } catch (error) {
    markInvalid(form, input, true);
    if (error instanceof TetherError && error.code === 'INVALID_DISCOUNT') emit('discount-invalid', { code }, form);
    else reportError(error, 'discount');
  }
}

function onSubmit(event: SubmitEvent): void {
  const { target } = event;
  const form = isElement(target) ? target.closest(sel('discount-form')) : null;
  if (!form) return;
  event.preventDefault();
  const input = codeInputOf(form);
  const code = input?.value.trim();
  if (!code) return;
  void busy(form, () => applyCode(form, input, code));
}

function onInput(event: Event): void {
  const { target } = event;
  if (!isElement(target)) return;
  const form = target.closest(sel('discount-form'));
  if (!form) return;
  form.classList.remove('is-invalid');
  target.removeAttribute('aria-invalid');
}

function onClick(event: MouseEvent): void {
  const { target } = event;
  const remove = isElement(target) ? target.closest(sel('discount-remove')) : null;
  if (!remove) return;
  event.preventDefault();
  const code = remove.closest(sel('discount-code'))?.getAttribute(attr('discount-code'));
  if (!code) return;
  Cart.removeDiscount(code).catch((error: unknown) => {
    reportError(error, 'discount');
  });
}

/** Binds the document-wide listeners, once per page load of the script. */
export function bindDiscountControls(): void {
  // Capture: the submit is handled before a router (Astro's ClientRouter) turns it into a navigation.
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('input', onInput);
  document.addEventListener('click', onClick);
}
