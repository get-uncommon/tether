/**
 * Customer account pages, an optional part the account part loads on pages that use them: the order page with
 * returns, the profile form, addresses and subscriptions. Each operation is one of the Worker's fixed routes, which
 * checks the input (account/operations.ts).
 */
import { reportError } from './config.ts';
import { qsa, sel } from './dom.ts';
import { pagesContext } from './account/operations.ts';
import { renderOrder, showOrderState } from './account/order-page.ts';
import { renderAddresses } from './account/addresses-view.ts';
import { renderSubscriptions } from './account/subscriptions-view.ts';
import { listenToPages } from './account/page-events.ts';
import { showIn } from './account/markup.ts';
import type { AccountCustomer } from './account/answers.ts';

export {
  setup,
  order,
  updateProfile,
  addresses,
  saveAddress,
  deleteAddress,
  subscriptions,
  subscriptionAction,
  requestReturn,
} from './account/operations.ts';

/** The profile fields a `tether-profile-form` is filled with. */
const PROFILE_FIELDS = ['firstName', 'lastName'] as const;

/** Fills the profile form with the customer's name, leaving a field the visitor has typed in alone. */
async function renderProfile(form: HTMLElement): Promise<void> {
  if (!(form instanceof window.HTMLFormElement)) return;
  let customer: AccountCustomer | null;
  try {
    customer = await pagesContext().customer();
  } catch (error) {
    // The form stays empty and still saves: only the prefill is missing.
    reportError(error, 'account');
    return;
  }
  if (!customer) return;
  const fields = form.elements;
  PROFILE_FIELDS.forEach((name) => {
    const input = fields.namedItem(name);
    const isTextField = input instanceof window.HTMLInputElement || input instanceof window.HTMLTextAreaElement;
    if (isTextField && !input.dataset['tetherTouched']) input.value = customer[name] ?? '';
  });
}

let listening = false;

/** Renders the order page, profile form, addresses and subscriptions in `root`: only what it has. */
export async function renderPages(root: ParentNode = document): Promise<void> {
  if (!listening) {
    listening = true;
    listenToPages();
  }
  await Promise.all([
    ...qsa(root, sel('order')).map((el) => renderOrder(el)),
    ...qsa(root, sel('profile-form')).map((form) => renderProfile(form)),
    renderAddresses(root),
    renderSubscriptions(root),
  ]);
}

/**
 * The error state of every account page in `root`, for when nobody can say whether a customer is logged in (the
 * Worker or Shopify can't be reached).
 */
export function showUnavailable(root: ParentNode): void {
  qsa(root, sel('order')).forEach((el) => {
    showOrderState(el, 'error');
  });
  showIn(root, 'show', {
    'addresses-loading': false,
    'addresses-error': true,
    'subscriptions-loading': false,
    'subscriptions-error': true,
  });
}
