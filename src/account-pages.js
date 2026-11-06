/**
 * Customer account pages, an optional part the account part loads on pages that use them: the order page with
 * returns, the profile form, addresses and subscriptions. The operations and their input checks are shared with the
 * Worker (server/src/shared/account-ops.js), so both modes do the same.
 */
import { reportError } from './config.js';
import { qsa, sel } from './dom.js';
import { pagesContext } from './account/operations.js';
import { renderOrder, showOrderState } from './account/order-page.js';
import { renderAddresses } from './account/addresses-view.js';
import { renderSubscriptions } from './account/subscriptions-view.js';
import { listenToPages } from './account/page-events.js';
import { showIn } from './account/markup.js';

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
} from './account/operations.js';

/** The profile fields a `tether-profile-form` is filled with. */
const PROFILE_FIELDS = /** @type {const} */ (['firstName', 'lastName']);

/**
 * Fills the profile form with the customer's name, leaving a field the visitor has typed in alone.
 *
 * @param {HTMLElement} form
 */
async function renderProfile(form) {
  const customer = await pagesContext()
    .customer()
    .catch((/** @type {unknown} */ error) => {
      // The form stays empty and still saves: only the prefill is missing.
      reportError(error, 'account');
      return null;
    });
  if (!customer || form.tagName !== 'FORM') return;
  const fields = /** @type {HTMLFormElement} */ (form).elements;
  PROFILE_FIELDS.forEach((name) => {
    const input = fields.namedItem(name);
    const isTextField = input instanceof window.HTMLInputElement || input instanceof window.HTMLTextAreaElement;
    if (isTextField && !input.dataset['tetherTouched']) input.value = customer[name] ?? '';
  });
}

let listening = false;

/**
 * Renders the order page, profile form, addresses and subscriptions in `root`: only what it has.
 *
 * @param {ParentNode} [root]
 * @returns {Promise<void>}
 */
export async function renderPages(root = document) {
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
 *
 * @param {ParentNode} root
 */
export function showUnavailable(root) {
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
