/**
 * Sending the visitor to Shopify's checkout. The URL comes from Shopify at click time, because the cart's checkout URL
 * changes with its market and customer; the account part resolves a logged-in customer's own (`setCheckoutResolver`).
 */
import { cfg, reportError } from '../config.ts';
import { TetherError } from '../client.ts';
import { isHttpsUrl } from '../shopify-values.ts';
import { emit } from '../dom.ts';
import { fetchCheckoutUrl } from './mutations.ts';
import { currentCart, mayFill, runInOrder, savedCartId } from './store.ts';
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

/** @returns The saved cart's id, `null` with nothing to check out. */
function cartToCheckOut(): string | null {
  const cart = currentCart();
  return cart && !cart.totalQuantity ? null : savedCartId();
}

/**
 * Goes to Shopify's checkout, with the cart as the changes already queued leave it. With `_blank` the tab opens inside
 * the click (Safari blocks `window.open` after an await) and gets its URL once there is one, so a queued change that
 * empties the cart closes the tab again.
 *
 * @returns The checkout URL; `null` with nothing to check out, when the visitor closed the checkout tab first, or after
 *   a reported failure.
 */
export async function checkout(target: CheckoutTarget = cfg.checkoutTarget): Promise<string | null> {
  if (!cartToCheckOut() && !mayFill()) return null;
  const tab = target === '_blank' ? window.open('', '_blank') : null;
  if (tab) detachOpenerIfAllowed(tab);
  try {
    // The changes queued before the click reach Shopify first. The URL is looked up outside the queue: the account's
    // resolver can change the cart, and a change queued behind a task waiting for it would never start.
    await runInOrder(() => Promise.resolve());
    const cartId = cartToCheckOut();
    const url = cartId && (await checkoutUrl(cartId));
    if (!url) {
      tab?.close();
      return null;
    }
    if (!isHttpsUrl(url)) throw new TetherError('The checkout URL is not https: not opened');
    // The visitor closed the checkout tab before its URL came, so this page stays.
    if (tab?.closed) return null;
    emit('checkout', { url, cart: currentCart() });
    (tab ?? window).location.href = url;
    return url;
  } catch (error) {
    tab?.close();
    reportError(error, 'checkout failed');
    return null;
  }
}
