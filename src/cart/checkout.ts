/**
 * Sending the visitor to Shopify's checkout. The URL comes from Shopify at click time, because the cart's checkout URL
 * changes with its market and customer; the account part resolves a logged-in customer's own (`setCheckoutResolver`).
 */
import { cfg, reportError } from '../config.ts';
import { TetherError } from '../client.ts';
import { isHttpsUrl } from '../shopify-values.ts';
import { emit } from '../dom.ts';
import { fetchCheckoutUrl } from './mutations.ts';
import { currentCart, savedCartId } from './store.ts';
import type { CheckoutTarget } from '../config.ts';

type CheckoutUrlAnswer = { kind: 'url'; url: string | null } | { kind: 'failed'; error: unknown };

/**
 * The logged-in customer's checkout URL for the cart; `null` when nobody is logged in, so the cart's own checkout URL
 * is used.
 */
type CheckoutResolver = () => Promise<string | null>;

let resolveAccountCheckout: CheckoutResolver | null = null;

/** Sets the account part's checkout URL, or clears it with `null`. A URL it answers opens checkout logged in. */
export function setCheckoutResolver(resolver: CheckoutResolver | null): void {
  resolveAccountCheckout = resolver;
}

/**
 * @returns Shopify's answer as a value, so the request can run alongside the account's and its failure is read only
 *   when its URL is the one used.
 */
const askCheckoutUrl = (cartId: string): Promise<CheckoutUrlAnswer> =>
  fetchCheckoutUrl(cartId).then(
    (url) => ({ kind: 'url', url }),
    (error: unknown) => ({ kind: 'failed', error }),
  );

/**
 * @returns The logged-in customer's checkout URL. When the account can't give one, the failure is reported and the
 *   cart's own checkout URL is used, which still checks out (without the login).
 */
async function accountCheckoutUrl(): Promise<string | null> {
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

/** @throws {TetherError} `ERROR` without a checkout URL (the cart is empty or Shopify no longer has it). */
async function checkoutUrl(cartId: string): Promise<string> {
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
 */
function detachOpenerIfAllowed(tab: Window) {
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
 * @returns The checkout URL, `null` with nothing to check out or after a reported failure.
 */
export async function checkout(target: CheckoutTarget = cfg.checkoutTarget): Promise<string | null> {
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
