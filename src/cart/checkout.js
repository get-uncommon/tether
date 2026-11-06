/**
 * Sending the visitor to Shopify's checkout. The URL comes from Shopify at click time, because the cart's checkout URL
 * changes with its market and customer; the account part resolves a logged-in customer's own (`setCheckoutResolver`).
 */
import { cfg, reportError } from '../config.js';
import { TetherError } from '../client.js';
import { isHttpsUrl } from '../shopify-values.js';
import { emit } from '../dom.js';
import { fetchCheckoutUrl } from './mutations.js';
import { currentCart, savedCartId } from './store.js';
/** @import { CheckoutTarget } from '../config.js' */

/** @typedef {{ kind: 'url', url: string | null } | { kind: 'failed', error: unknown }} CheckoutUrlAnswer */
/**
 * @typedef {() => Promise<string | null>} CheckoutResolver The logged-in customer's checkout URL for the cart;
 *   `null` when nobody is logged in, so the cart's own checkout URL is used.
 */

/** @type {CheckoutResolver | null} */
let resolveAccountCheckout = null;

/**
 * Sets the account part's checkout URL, or clears it with `null`. A URL it answers opens checkout logged in.
 *
 * @param {CheckoutResolver | null} resolver
 */
export function setCheckoutResolver(resolver) {
  resolveAccountCheckout = resolver;
}

/**
 * @param {string} cartId
 * @returns {Promise<CheckoutUrlAnswer>} Shopify's answer as a value, so the request can run alongside the account's
 *   and its failure is read only when its URL is the one used.
 */
const askCheckoutUrl = (cartId) =>
  fetchCheckoutUrl(cartId).then(
    (url) => ({ kind: /** @type {const} */ ('url'), url }),
    (/** @type {unknown} */ error) => ({ kind: /** @type {const} */ ('failed'), error }),
  );

/**
 * @returns {Promise<string | null>} The logged-in customer's checkout URL. When the account can't give one, the
 *   failure is reported and the cart's own checkout URL is used, which still checks out (without the login).
 */
async function accountCheckoutUrl() {
  if (!resolveAccountCheckout) return null;
  try {
    const url = await resolveAccountCheckout();
    // Shopify's checkout shows the customer as logged in only with this parameter.
    return url && `${url}${url.includes('?') ? '&' : '?'}logged_in=true`;
  } catch (error) {
    reportError(error, 'account checkout');
    return null;
  }
}

/**
 * @param {string} cartId
 * @returns {Promise<string>}
 * @throws {TetherError} `ERROR` without a checkout URL (the cart is empty or Shopify no longer has it).
 */
async function checkoutUrl(cartId) {
  const cartAnswer = askCheckoutUrl(cartId);
  const accountUrl = await accountCheckoutUrl();
  if (accountUrl) return accountUrl;
  const answer = await cartAnswer;
  if (answer.kind === 'failed') throw answer.error;
  if (!answer.url) throw new TetherError('No checkoutUrl (cart empty or expired)');
  return answer.url;
}

/**
 * A new tab's `opener` gives the checkout page a handle on this one; a browser that doesn't let a script clear it
 * leaves the tab as it opened.
 *
 * @param {Window} tab
 */
function detachOpenerIfAllowed(tab) {
  try {
    tab.opener = null;
  } catch {
    // The browser keeps `opener` read-only: see the function's comment.
  }
}

/**
 * Goes to Shopify's checkout. With `_blank` the tab opens inside the click (Safari blocks `window.open` after an
 * await) and gets its URL once there is one.
 *
 * @param {CheckoutTarget} target
 * @returns {Promise<string | null>} The checkout URL, `null` with nothing to check out or after a reported failure.
 */
export async function checkout(target = cfg.checkoutTarget) {
  const cartId = savedCartId();
  const cart = currentCart();
  if (!cartId || (cart && !cart.totalQuantity)) return null;
  const tab = target === '_blank' ? window.open('', '_blank') : null;
  if (tab) detachOpenerIfAllowed(tab);
  try {
    const url = await checkoutUrl(cartId);
    if (!isHttpsUrl(url)) throw new TetherError('The checkout URL is not https: not opened');
    emit('checkout', { url, cart: currentCart() });
    if (tab && !tab.closed) tab.location.href = url;
    else window.location.href = url;
    return url;
  } catch (error) {
    tab?.close();
    reportError(error, 'checkout failed');
    return null;
  }
}
