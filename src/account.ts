/**
 * Customer accounts (Shopify Customer Account API), as an optional part: loaded only when `account` is configured
 * and the page uses it, or a login is coming back, or the visitor may be logged in.
 *
 *   window.TETHER_CONFIG = { …, account: { server: '/_tether/account' } }
 *
 *   <button tether-account-login>Log in</button>
 *   <button tether-account-logout tether-show="logged-in">Log out</button>
 *   <span tether-account-bind="first-name"></span>             first-name, last-name, name, email, address
 *   <div tether-orders>                                       the customer's orders (first child = template)
 *     <a tether-order-bind="url"><span tether-order-bind="name"></span> · <span tether-order-bind="date"></span></a>
 *   </div>
 *   <p tether-show="logged-out">…</p>
 *
 * The site's Worker logs the customer in and holds the tokens (`account/server-client.ts` is this browser's side of
 * it), so no token is ever in the browser. The order page, profile, addresses, subscriptions and returns are the
 * `account-pages` part, loaded only on pages that use them.
 */
import { cfg, log, reportError } from './config.ts';
import { TetherError } from './client.ts';
import { sel, get, qsa, setText, show, emit } from './dom.ts';
import { Cart } from './cart.ts';
import { loadPart } from './lazy.ts';
import type { Parts } from './lazy.ts';
import {
  forgetServerLogin,
  isServerLoggedIn,
  serverCheckoutUrl,
  serverFetch,
  serverLogin,
  serverLoginRedirect,
  serverLogout,
} from './account/server-client.ts';
import { DEFAULT_ORDER_COUNT, MAX_ORDER_COUNT, isOrderCount, renderOrderList } from './account/order-list.ts';
import { ownValue } from './account/markup.ts';
import { toAccountOrders } from './account/answers.ts';
import type { AccountCustomer } from './account/answers.ts';
import { isLoginOutcome } from './account-marks.ts';
import type { AccountOrder } from '../server/src/shared/account-orders.ts';
import type { AddressFields, ReturnLine } from './account/operations.ts';
import type {
  AccountAddress,
  CustomerAddress,
  OpenedReturn,
  OrderDetail,
  Profile,
  SubscriptionChange,
  SubscriptionContract,
} from './account/page-answers.ts';
import type { SubscriptionAction } from '../server/src/shared/account-routes.ts';

/**
 * `unknown` when the Worker or Shopify can't say: the page shows its logged-out content, and the account pages their
 * error state.
 */
type LoginState = { kind: 'logged-in' } | { kind: 'logged-out' } | { kind: 'unknown'; error: unknown };

/** The attributes of the account pages, which are their own part. */
const PAGE_ATTRIBUTES = ['order', 'addresses', 'subscriptions', 'profile-form', 'address-form'];

/** @returns True when the Worker last said a customer is logged in; false before it has been asked. */
export const isLoggedIn = isServerLoggedIn;

/**
 * Through the Worker to Shopify's login page; the visitor comes back to `returnTo`.
 *
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`.
 */
export function login({
  returnTo = window.location.href,
  locale,
}: { returnTo?: string; locale?: string } = {}): Promise<void> {
  // In a promise, so a missing `account.server` rejects as it does for every other account function.
  return new Promise((resolve) => {
    serverLoginRedirect({ returnTo, locale });
    resolve();
  });
}

/**
 * @returns The logged-in customer, `null` when nobody is.
 * @throws {TetherError} When the Worker can't be reached or fails.
 */
export async function customer(): Promise<AccountCustomer | null> {
  const me = await serverLogin();
  return me.loggedIn ? me.customer : null;
}

/**
 * @param options `first`: a whole number from 1 to `MAX_ORDER_COUNT`.
 * @returns The customer's most recent orders, newest first; none when nobody is logged in.
 * @throws {TetherError} `INVALID` for another `first`, which is refused before any request; else when the Worker or
 *   Shopify can't answer.
 */
export async function orders({ first = DEFAULT_ORDER_COUNT }: { first?: number } = {}): Promise<AccountOrder[]> {
  if (!isOrderCount(first)) {
    throw new TetherError(`Customer accounts: orders() takes first from 1 to ${String(MAX_ORDER_COUNT)}`, {
      code: 'INVALID',
    });
  }
  const answer = await serverFetch(`/orders?${new URLSearchParams({ first: String(first) }).toString()}`);
  return answer.kind === 'logged-out' ? [] : toAccountOrders(answer.data['orders']);
}

/**
 * Logs out here and at Shopify, and unlinks the cart. Sends `tether:account-logout`.
 *
 * @param options `returnTo`: where Shopify sends the visitor afterwards.
 */
export async function logout({
  returnTo = cfg.account?.logoutUrl || `${window.location.origin}/`,
}: { returnTo?: string } = {}): Promise<void> {
  if ((await serverLogout(returnTo)) === 'stayed') await render(document);
}

async function loginState(): Promise<LoginState> {
  try {
    return (await serverLogin()).loggedIn ? { kind: 'logged-in' } : { kind: 'logged-out' };
  } catch (error) {
    return { kind: 'unknown', error };
  }
}

const usesPages = (root: ParentNode): boolean => PAGE_ATTRIBUTES.some((name) => qsa(root, sel(name)).length > 0);

/**
 * `tether-account-link`: Shopify's own pages, for what has to stay there: `subscriptions` and `payment`
 * (`account.subscriptionsUrl` / `paymentUrl`), or the account itself.
 */
function linkShopifyPages(root: ParentNode): void {
  qsa(root, sel('account-link')).forEach((link) => {
    link.setAttribute('href', shopifyPageUrl(get(link, 'account-link')));
  });
}

/**
 * @param page The `tether-account-link` value.
 * @returns The configured page for it, else the shop's account.
 */
function shopifyPageUrl(page: string | null): string {
  const account = cfg.account;
  const fallback = `https://${cfg.domain}/account`;
  if (page === 'payment') return account?.paymentUrl || account?.subscriptionsUrl || fallback;
  if (page === 'subscriptions') return account?.subscriptionsUrl || fallback;
  return fallback;
}

/**
 * Fills the account markup in `root`: what shows when logged in or out, the customer, their orders, and the account
 * pages.
 */
export async function render(root: ParentNode = document): Promise<void> {
  const state = await loginState();
  if (state.kind === 'unknown') reportError(state.error, 'account');
  const loggedIn = state.kind === 'logged-in';
  qsa(root, sel('show')).forEach((el) => {
    const condition = get(el, 'show');
    if (condition === 'logged-in') show(el, loggedIn);
    if (condition === 'logged-out') show(el, !loggedIn);
  });
  linkShopifyPages(root);
  if (state.kind === 'unknown' && usesPages(root)) {
    (await pages()).showUnavailable(root);
    return;
  }
  if (!loggedIn) return;
  await bindCustomer(root);
  await Promise.all([
    renderOrderList(root, (first) => orders({ first })),
    usesPages(root) ? pages().then((part) => part.renderPages(root)) : null,
  ]);
}

/**
 * `tether-account-bind`: the customer's name, email, default address. A failure is reported and leaves the binds as
 * they are.
 */
async function bindCustomer(root: ParentNode): Promise<void> {
  const binds = qsa(root, sel('account-bind'));
  if (!binds.length) return;
  let profile: AccountCustomer | null;
  try {
    profile = await customer();
  } catch (error) {
    reportError(error, 'account');
    return;
  }
  if (!profile) return;
  const texts: Record<string, string | null | undefined> = {
    'first-name': profile.firstName,
    'last-name': profile.lastName,
    name: profile.displayName,
    email: profile.emailAddress?.emailAddress,
    address: profile.defaultAddress?.formatted.join(', '),
  };
  binds.forEach((el) => {
    const text = ownValue(texts, get(el, 'account-bind') ?? '');
    if (text != null) setText(el, text);
  });
}

let pagesPart: Promise<Parts['account-pages']> | null = null;

/** @returns The account pages part, sharing this part's session. */
function pages(): Promise<Parts['account-pages']> {
  pagesPart ??= loadPart('account-pages').then((part) => {
    part.setup({ serverFetch, customer, bindCustomer, reset: forgetServerLogin });
    return part;
  });
  return pagesPart;
}

/** One of the customer's orders, in full (lines, totals, addresses, fulfillments, returns). */
export const order = (id: string | number): Promise<OrderDetail | null> => pages().then((part) => part.order(id));
export const updateProfile = (fields?: { firstName?: string; lastName?: string }): Promise<Profile> =>
  pages().then((part) => part.updateProfile(fields));
export const addresses = (): Promise<CustomerAddress[]> => pages().then((part) => part.addresses());
/** Creates an address, or updates the one with `id`. */
export const saveAddress = (
  address: AddressFields | null,
  options?: { id?: string; isDefault?: boolean },
): Promise<AccountAddress> => pages().then((part) => part.saveAddress(address, options));
export const deleteAddress = (id: string): Promise<string> => pages().then((part) => part.deleteAddress(id));
export const subscriptions = (): Promise<SubscriptionContract[]> => pages().then((part) => part.subscriptions());
export const subscriptionAction = (id: string | number, action: SubscriptionAction): Promise<SubscriptionChange> =>
  pages().then((part) => part.subscriptionAction(id, action));
export const requestReturn = (orderId: string | number, lines: ReturnLine[]): Promise<OpenedReturn> =>
  pages().then((part) => part.requestReturn(orderId, lines));

function onClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof window.Element)) return;
  if (target.closest(sel('account-login'))) {
    event.preventDefault();
    login().catch((error: unknown) => {
      reportError(error, 'login');
    });
  } else if (target.closest(sel('account-logout'))) {
    event.preventDefault();
    logout().catch((error: unknown) => {
      reportError(error, 'logout');
    });
  }
}

/**
 * Back from the Worker's login (`?account=`): drops the mark and sends `tether:account-login`, or
 * `tether:account-error` with the outcome as its `error` when the login didn't finish.
 */
function finishServerLogin(): void {
  const url = new URL(window.location.href);
  const outcome = url.searchParams.get('account');
  if (!isLoginOutcome(outcome)) return;
  url.searchParams.delete('account');
  window.history.replaceState(window.history.state, '', url);
  switch (outcome) {
    case 'in':
      emit('account-login', {});
      break;
    case 'expired':
    case 'error':
      emit('account-error', { error: outcome });
      break;
  }
}

let started = false;

/**
 * Called by the core on mount: on the first one, finishes a login that's coming back and lets the Worker link the
 * cart at checkout; then fills the page.
 */
export async function mountAccount(root: ParentNode = document): Promise<void> {
  if (started) {
    await render(root);
    return;
  }
  started = true;
  document.addEventListener('click', onClick);
  finishServerLogin();
  Cart.setCheckoutResolver(serverCheckoutUrl);
  await render(root);
  log('account', isLoggedIn() ? 'logged in' : 'logged out');
}
