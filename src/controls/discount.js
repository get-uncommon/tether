/**
 * The discount code form (`tether-discount-form` with `tether-discount-input`) and the remove buttons of applied codes
 * (`tether-discount-remove` inside `tether-discount-code`), delegated from the document. A code Shopify refuses marks
 * the form `is-invalid` (and the input `aria-invalid`) until the visitor types again.
 */
import { reportError } from '../config.js';
import { TetherError } from '../client.js';
import { Cart } from '../cart.js';
import { attr, sel, busy, emit } from '../dom.js';

/**
 * @param {EventTarget | null} target
 * @returns {target is Element}
 */
const isElement = (target) => target instanceof window.Element;

/**
 * @param {Element} form
 * @returns {HTMLInputElement | null}
 */
function codeInputOf(form) {
  const input = form.querySelector(sel('discount-input')) ?? form.querySelector('input');
  return input instanceof window.HTMLInputElement ? input : null;
}

/**
 * @param {Element} form
 * @param {HTMLInputElement | null} input
 * @param {boolean} invalid
 */
function markInvalid(form, input, invalid) {
  form.classList.toggle('is-invalid', invalid);
  if (invalid) input?.setAttribute('aria-invalid', 'true');
  else input?.removeAttribute('aria-invalid');
}

/**
 * @param {Element} form
 * @param {HTMLInputElement | null} input
 * @param {string} code
 */
async function applyCode(form, input, code) {
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

/** @param {SubmitEvent} event */
function onSubmit(event) {
  const { target } = event;
  const form = isElement(target) ? target.closest(sel('discount-form')) : null;
  if (!form) return;
  event.preventDefault();
  const input = codeInputOf(form);
  const code = input?.value.trim();
  if (!code) return;
  void busy(form, () => applyCode(form, input, code));
}

/** @param {Event} event */
function onInput(event) {
  const { target } = event;
  if (!isElement(target)) return;
  const form = target.closest(sel('discount-form'));
  if (!form) return;
  form.classList.remove('is-invalid');
  target.removeAttribute('aria-invalid');
}

/** @param {MouseEvent} event */
function onClick(event) {
  const { target } = event;
  const remove = isElement(target) ? target.closest(sel('discount-remove')) : null;
  if (!remove) return;
  event.preventDefault();
  const code = remove.closest(sel('discount-code'))?.getAttribute(attr('discount-code'));
  if (!code) return;
  Cart.removeDiscount(code).catch((/** @type {unknown} */ error) => {
    reportError(error, 'discount');
  });
}

/** Binds the document-wide listeners, once per page load of the script. */
export function bindDiscountControls() {
  // Capture: the submit is handled before a router (Astro's ClientRouter) turns it into a navigation.
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('input', onInput);
  document.addEventListener('click', onClick);
}
