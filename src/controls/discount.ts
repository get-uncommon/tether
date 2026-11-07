/**
 * The discount code form (`tether-discount-form` with `tether-discount-input`) and the remove buttons of applied codes
 * (`tether-discount-remove` inside `tether-discount-code`), delegated from the document. Applying a code is in the
 * extras part, loaded on the first submit. A code Shopify refuses marks the form `is-invalid` (and the input
 * `aria-invalid`) until the visitor types again.
 */
import { reportError } from '../config.ts';
import { Cart } from '../cart.ts';
import { attr, sel, busy, isElement } from '../dom.ts';
import { loadPart } from '../lazy.ts';

function codeInputOf(form: Element): HTMLInputElement | null {
  const input = form.querySelector(sel('discount-input')) ?? form.querySelector('input');
  return input instanceof window.HTMLInputElement ? input : null;
}

function onSubmit(event: SubmitEvent): void {
  const { target } = event;
  const form = isElement(target) ? target.closest(sel('discount-form')) : null;
  if (!form) return;
  event.preventDefault();
  const input = codeInputOf(form);
  const code = input?.value.trim();
  if (!code) return;
  busy(form, () => loadPart('extras').then((part) => part.applyDiscountCode(form, input, code))).catch(
    (error: unknown) => {
      reportError(error, 'discount');
    },
  );
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
