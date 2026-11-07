/**
 * What the visitor does on the account pages: the profile and address forms, the address buttons, subscription
 * actions and return requests. Each change marks its form or row busy (`aria-busy`, `is-busy`), then sets
 * `tether-form-state` to `saved` or `error` with Shopify's message in `tether-form-error`.
 */
import { attr, get, isElement, isField, qsa, sel, setText } from '../dom.ts';
import {
  saveAddress,
  deleteAddress,
  subscriptionAction,
  requestReturn,
  updateProfile,
  pagesContext,
} from './operations.ts';
import type { ReturnLine } from './operations.ts';
import { renderAddresses, shownAddress } from './addresses-view.ts';
import { renderSubscriptions } from './subscriptions-view.ts';
import { renderOrder } from './order-page.ts';
import { TetherError } from '../client.ts';
import type { SubscriptionAction } from '../../server/src/shared/account-routes.ts';

const SUBSCRIPTION_ACTIONS: readonly SubscriptionAction[] = ['pause', 'resume', 'skip', 'unskip', 'cancel'];

const isSubscriptionAction = (value: string | null): value is SubscriptionAction =>
  SUBSCRIPTION_ACTIONS.some((action) => action === value);

const isForm = (el: Element): el is HTMLFormElement => el instanceof window.HTMLFormElement;

/** @returns The form's text fields by name. */
function fieldsOf(form: HTMLFormElement): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of form.elements) {
    if (!isField(field)) continue;
    if (!field.name || field.type === 'submit' || field.type === 'button' || field.type === 'checkbox') continue;
    fields[field.name] = field.value;
  }
  return fields;
}

/** @returns What to tell the customer: Shopify's own messages when it refused the input. */
function customerMessage(error: unknown): string {
  const userErrors = error instanceof TetherError ? (error.userErrors ?? []) : [];
  const message = userErrors.map((userError) => userError.message).join(' ');
  if (message) return message;
  const text = error instanceof Error && error.message ? error.message : 'Something went wrong';
  return text.replace(/^Customer accounts: /, '');
}

/**
 * Runs one change for `el`; a second one while it is on its way (Enter, a double click) is ignored. The failure is
 * shown in `el` (`tether-form-error`), the place the customer looks.
 */
async function act(el: HTMLElement, change: () => Promise<void>): Promise<'saved' | 'error' | 'busy'> {
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
      setText(box, customerMessage(error));
    });
    return 'error';
  } finally {
    el.classList.remove('is-busy');
    el.removeAttribute('aria-busy');
  }
}

/** @returns True when the button asks no `tether-confirm` question, or the visitor agreed. */
const confirmed = (button: Element): boolean => {
  const question = get(button, 'confirm');
  return !question || window.confirm(question);
};

const addressFormReset = (form: HTMLFormElement): void => {
  form.reset();
  delete form.dataset['tetherAddressId'];
};

function onSubmit(event: SubmitEvent): void {
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

/** Fills the address form with a shown address, to edit it. */
function editAddress(id: string): void {
  const address = shownAddress(id);
  const form = document.querySelector(sel('address-form'));
  if (!address || !form || !isForm(form)) return;
  form.dataset['tetherAddressId'] = address.id;
  const valuesByName: Readonly<Record<string, unknown>> = { ...address };
  for (const field of form.elements) {
    if (!isField(field)) continue;
    if (field.name === 'isDefault') {
      if (field instanceof window.HTMLInputElement) field.checked = address.isDefault;
    } else if (field.name && Object.hasOwn(valuesByName, field.name)) {
      const value = valuesByName[field.name];
      field.value = typeof value === 'string' ? value : '';
    }
  }
  form.scrollIntoView({ block: 'nearest' });
}

/** @returns True when the click was on an address button. */
function onAddressClick(event: MouseEvent, target: Element): boolean {
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

/** @param button A `tether-subscription-action` button. */
function onSubscriptionAction(button: HTMLElement): void {
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

/** @param row A line row of the order page. */
function returnLineOf(row: HTMLElement): ReturnLine {
  const quantity = row.querySelector(sel('return-quantity'));
  const reason = row.querySelector(sel('return-reason'));
  const note = row.querySelector(sel('return-note'));
  const valueOf = (field: Element | null) =>
    field && 'value' in field && typeof field.value === 'string' ? field.value : '';
  const line: ReturnLine = {
    lineItemId: row.dataset['tetherLine'] ?? '',
    quantity: Number.parseInt(valueOf(quantity) || '0', 10),
  };
  const reasonId = valueOf(reason);
  if (reasonId) line.reasonId = reasonId;
  const noteText = valueOf(note);
  if (noteText) line.note = noteText;
  return line;
}

/** @param button A `tether-order-return` button. */
function onReturnRequest(button: HTMLElement): void {
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

function onClick(event: MouseEvent): void {
  const target = event.target;
  if (!isElement(target)) return;
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
export function listenToPages(): void {
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
