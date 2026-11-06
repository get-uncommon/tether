/**
 * What the visitor does on the account pages: the profile and address forms, the address buttons, subscription
 * actions and return requests. Each change marks its form or row busy (`aria-busy`, `is-busy`), then sets
 * `tether-form-state` to `saved` or `error` with Shopify's message in `tether-form-error`.
 */
import { attr, get, qsa, sel, setText } from '../dom.js';
import {
  saveAddress,
  deleteAddress,
  subscriptionAction,
  requestReturn,
  updateProfile,
  pagesContext,
} from './operations.js';
import { renderAddresses, shownAddress } from './addresses-view.js';
import { renderSubscriptions } from './subscriptions-view.js';
import { renderOrder } from './order-page.js';
import { TetherError } from '../client.js';
/** @import { ReturnLine } from './operations.js' */
/** @import { SubscriptionAction } from '../../server/src/shared/account-ops.js' */

/** @type {readonly SubscriptionAction[]} */
const SUBSCRIPTION_ACTIONS = ['pause', 'resume', 'skip', 'unskip', 'cancel'];

/**
 * @param {string | null} value
 * @returns {value is SubscriptionAction}
 */
const isSubscriptionAction = (value) => SUBSCRIPTION_ACTIONS.some((action) => action === value);

/**
 * @param {Element} el
 * @returns {el is HTMLInputElement}
 */
const isInput = (el) => el.tagName === 'INPUT';

/**
 * @param {Element} el
 * @returns {el is HTMLFormElement}
 */
const isForm = (el) => el.tagName === 'FORM';

/**
 * @param {HTMLFormElement} form
 * @returns {Record<string, string>} The form's text fields by name.
 */
function fieldsOf(form) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const field of form.elements) {
    if (!isInput(field) && field.tagName !== 'SELECT' && field.tagName !== 'TEXTAREA') continue;
    const input = /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ (field);
    if (!input.name || input.type === 'submit' || input.type === 'button' || input.type === 'checkbox') continue;
    fields[input.name] = input.value;
  }
  return fields;
}

/**
 * @param {unknown} error
 * @returns {string} What to tell the customer: Shopify's own messages when it refused the input.
 */
function messageOf(error) {
  const userErrors = error instanceof TetherError ? (error.userErrors ?? []) : [];
  const message = userErrors.map((userError) => userError.message).join(' ');
  if (message) return message;
  const text = error instanceof Error && error.message ? error.message : 'Something went wrong';
  return text.replace(/^Customer accounts: /, '');
}

/**
 * Runs one change for `el`; a second one while it is on its way (Enter, a double click) is ignored. The failure is
 * shown in `el` (`tether-form-error`), the place the customer looks.
 *
 * @param {HTMLElement} el
 * @param {() => Promise<void>} change
 * @returns {Promise<'saved' | 'error' | 'busy'>}
 */
async function act(el, change) {
  if (el.getAttribute('aria-busy') === 'true') return 'busy';
  el.classList.add('is-busy');
  el.setAttribute('aria-busy', 'true');
  el.setAttribute(attr('form-state'), 'pending');
  const errorBoxes = qsa(el, sel('form-error'));
  errorBoxes.forEach((box) => {
    setText(box, '');
  });
  try {
    await change();
    el.setAttribute(attr('form-state'), 'saved');
    return 'saved';
  } catch (error) {
    el.setAttribute(attr('form-state'), 'error');
    errorBoxes.forEach((box) => {
      setText(box, messageOf(error));
    });
    return 'error';
  } finally {
    el.classList.remove('is-busy');
    el.removeAttribute('aria-busy');
  }
}

/**
 * @param {Element} button
 * @returns {boolean} True when the button asks no `tether-confirm` question, or the visitor agreed.
 */
const confirmed = (button) => {
  const question = get(button, 'confirm');
  return !question || window.confirm(question);
};

/** @param {HTMLFormElement} form */
const addressFormReset = (form) => {
  form.reset();
  delete form.dataset['tetherAddressId'];
};

/** @param {SubmitEvent} event */
function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof window.HTMLFormElement)) return;
  if (form.matches(sel('profile-form'))) {
    event.preventDefault();
    void act(form, async () => {
      await updateProfile(fieldsOf(form));
      await pagesContext().bindCustomer(document);
    });
  } else if (form.matches(sel('address-form'))) {
    event.preventDefault();
    const id = form.dataset['tetherAddressId'];
    const box = form.elements.namedItem('isDefault');
    const isDefault = box instanceof window.HTMLInputElement && box.checked;
    void act(form, async () => {
      await saveAddress(fieldsOf(form), { id, isDefault });
      addressFormReset(form);
      await renderAddresses(document);
    });
  }
}

/**
 * Fills the address form with a shown address, to edit it.
 *
 * @param {string} id
 */
function editAddress(id) {
  const address = shownAddress(id);
  const form = document.querySelector(sel('address-form'));
  if (!address || !form || !isForm(form)) return;
  form.dataset['tetherAddressId'] = address.id;
  for (const field of form.elements) {
    if (!isInput(field) && field.tagName !== 'SELECT' && field.tagName !== 'TEXTAREA') continue;
    const input = /** @type {HTMLInputElement} */ (field);
    if (input.name === 'isDefault') input.checked = address.isDefault;
    else if (input.name && Object.hasOwn(address, input.name)) {
      const value = Object.entries(address).find(([key]) => key === input.name)?.[1];
      input.value = typeof value === 'string' ? value : '';
    }
  }
  form.scrollIntoView({ block: 'nearest' });
}

/**
 * @param {MouseEvent} event
 * @param {Element} target
 * @returns {boolean} True when the click was on an address button.
 */
function onAddressClick(event, target) {
  const row = target.closest('[data-tether-address]');
  const id = row instanceof window.HTMLElement ? row.dataset['tetherAddress'] : undefined;
  if (target.closest(sel('address-new'))) {
    const form = document.querySelector(sel('address-form'));
    if (form && isForm(form)) addressFormReset(form);
    return true;
  }
  if (!(row instanceof window.HTMLElement) || !id) return false;
  const deleteButton = target.closest(sel('address-delete'));
  if (deleteButton) {
    event.preventDefault();
    if (!confirmed(deleteButton)) return true;
    void act(row, async () => {
      await deleteAddress(id);
      await renderAddresses(document);
    });
  } else if (target.closest(sel('address-default'))) {
    event.preventDefault();
    void act(row, async () => {
      await saveAddress(null, { id, isDefault: true });
      await renderAddresses(document);
    });
  } else if (target.closest(sel('address-edit'))) {
    event.preventDefault();
    editAddress(id);
  } else {
    return false;
  }
  return true;
}

/** @param {HTMLElement} button A `tether-subscription-action` button. */
function onSubscriptionAction(button) {
  const row = button.closest('[data-tether-subscription]');
  const action = get(button, 'subscription-action');
  const disabled = ('disabled' in button && button.disabled === true) || button.classList.contains('is-disabled');
  if (!(row instanceof window.HTMLElement) || !isSubscriptionAction(action) || disabled || !confirmed(button)) return;
  const id = row.dataset['tetherSubscription'] ?? '';
  row.setAttribute(attr('subscription-state'), 'pending');
  void act(row, async () => {
    await subscriptionAction(id, action);
    await renderSubscriptions(document);
  }).then((outcome) => {
    const state = outcome === 'error' ? 'error' : 'done';
    // The re-render may have replaced the row: mark the one that shows this subscription now.
    qsa(document, '[data-tether-subscription]')
      .filter((candidate) => candidate === row || candidate.dataset['tetherSubscription'] === id)
      .forEach((candidate) => {
        candidate.setAttribute(attr('subscription-state'), state);
      });
  });
}

/**
 * @param {HTMLElement} row A line row of the order page.
 * @returns {ReturnLine}
 */
function returnLineOf(row) {
  const quantity = row.querySelector(sel('return-quantity'));
  const reason = row.querySelector(sel('return-reason'));
  const note = row.querySelector(sel('return-note'));
  /** @param {Element | null} field */
  const valueOf = (field) => (field && 'value' in field && typeof field.value === 'string' ? field.value : '');
  /** @type {ReturnLine} */
  const line = { lineItemId: row.dataset['tetherLine'] ?? '', quantity: Number.parseInt(valueOf(quantity) || '0', 10) };
  const reasonId = valueOf(reason);
  if (reasonId) line.reasonId = reasonId;
  const noteText = valueOf(note);
  if (noteText) line.note = noteText;
  return line;
}

/** @param {HTMLElement} button A `tether-order-return` button. */
function onReturnRequest(button) {
  const scope = button.closest(sel('order'));
  if (!(scope instanceof window.HTMLElement)) return;
  const orderId = scope.dataset['tetherOrderId'];
  if (!orderId) return;
  const lines = qsa(scope, '[data-tether-line]')
    .map(returnLineOf)
    .filter((line) => line.quantity > 0);
  if (!lines.length || !confirmed(button)) return;
  void act(scope, async () => {
    await requestReturn(orderId, lines);
    scope.dataset['tetherReturned'] = '1';
    await renderOrder(scope);
  });
}

/** @param {MouseEvent} event */
function onClick(event) {
  const target = event.target;
  if (!(target instanceof window.Element)) return;
  if (onAddressClick(event, target)) return;
  const subscriptionButton = target.closest(sel('subscription-action'));
  if (subscriptionButton instanceof window.HTMLElement) {
    event.preventDefault();
    onSubscriptionAction(subscriptionButton);
    return;
  }
  const returnButton = target.closest(sel('order-return'));
  if (returnButton instanceof window.HTMLElement) {
    event.preventDefault();
    onReturnRequest(returnButton);
  }
}

/** Listens on the document once, for every account page rendered into it. */
export function listenToPages() {
  // Capture: before a router (Astro's ClientRouter) turns the submit into a navigation with the fields in the URL.
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof window.HTMLElement && target.closest(sel('profile-form'))) {
      target.dataset['tetherTouched'] = '1';
    }
  });
  document.addEventListener('click', onClick);
}
