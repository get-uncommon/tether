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
 * The site's Worker logs the customer in and holds the tokens (`account/server-client.js` is this browser's side of
 * it), so no token is ever in the browser. The order page, profile, addresses, subscriptions and returns are the
 * `account-pages` part, loaded only on pages that use them.
 */
import { cfg, log, reportError } from './config.js';
import { TetherError } from './client.js';
import { sel, get, qsa, setText, show, emit } from './dom.js';
import { Cart } from './cart.js';
import { loadPart } from './lazy.js';
import {
  forgetServerLogin,
  isServerLoggedIn,
  serverCheckoutUrl,
  serverFetch,
  serverLogin,
  serverLoginRedirect,
  serverLogout,
} from './account/server-client.js';
import { DEFAULT_ORDER_COUNT, MAX_ORDER_COUNT, isOrderCount, renderOrderList } from './account/order-list.js';
import { ownValue } from './account/markup.js';
import { toAccountOrders } from './account/answers.js';
import { isLoginOutcome } from './account-marks.js';
/** @import { AccountCustomer } from './account/answers.js' */
/** @import { AccountOrder } from '../server/src/shared/account-orders.js' */
/** @import { Parts } from './lazy.js' */
/** @import { AddressFields, ReturnLine } from './account/operations.js' */
/** @import { SubscriptionAction } from '../server/src/shared/account-routes.js' */

/**
 * @typedef {{ kind: 'logged-in' } | { kind: 'logged-out' } | { kind: 'unknown', error: unknown }} LoginState
 *   `unknown` when the Worker or Shopify can't say: the page shows its logged-out content, and the account pages their
 *   error state.
 */

/** The attributes of the account pages, which are their own part. */
const PAGE_ATTRIBUTES = ['order', 'addresses', 'subscriptions', 'profile-form', 'address-form'];

/** @returns {boolean} True when the Worker last said a customer is logged in; false before it has been asked. */
export const isLoggedIn = isServerLoggedIn;

/**
 * Through the Worker to Shopify's login page; the visitor comes back to `returnTo`.
 *
 * @param {{ returnTo?: string, locale?: string }} [options]
 * @returns {Promise<void>}
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`.
 */
export function login({ returnTo = window.location.href, locale } = {}) {
  // In a promise, so a missing `account.server` rejects as it does for every other account function.
  return new Promise((resolve) => {
    serverLoginRedirect({ returnTo, locale });
    resolve();
  });
}

/**
 * @returns {Promise<AccountCustomer | null>} The logged-in customer, `null` when nobody is.
 * @throws {TetherError} When the Worker can't be reached or fails.
 */
export async function customer() {
  const me = await serverLogin();
  return me.loggedIn ? me.customer : null;
}

/**
 * @param {{ first?: number }} [options] `first`: a whole number from 1 to `MAX_ORDER_COUNT`.
 * @returns {Promise<AccountOrder[]>} The customer's most recent orders, newest first; none when nobody is logged in.
 * @throws {TetherError} `INVALID` for another `first`, which is refused before any request; else when the Worker or
 *   Shopify can't answer.
 */
export async function orders({ first = DEFAULT_ORDER_COUNT } = {}) {
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
 * @param {{ returnTo?: string }} [options] Where Shopify sends the visitor afterwards.
 * @returns {Promise<void>}
 */
export async function logout({ returnTo = cfg.account?.logoutUrl || `${window.location.origin}/` } = {}) {
  if ((await serverLogout(returnTo)) === 'stayed') await render(document);
}

/** @returns {Promise<LoginState>} */
async function loginState() {
  try {
    return (await serverLogin()).loggedIn ? { kind: 'logged-in' } : { kind: 'logged-out' };
  } catch (error) {
    return { kind: 'unknown', error };
  }
}

/** @param {ParentNode} root */
const usesPages = (root) => PAGE_ATTRIBUTES.some((name) => qsa(root, sel(name)).length > 0);

/**
 * `tether-account-link`: Shopify's own pages, for what has to stay there: `subscriptions` and `payment`
 * (`account.subscriptionsUrl` / `paymentUrl`), or the account itself.
 *
 * @param {ParentNode} root
 */
function linkShopifyPages(root) {
  qsa(root, sel('account-link')).forEach((link) => {
    link.setAttribute('href', shopifyPageUrl(get(link, 'account-link')));
  });
}

/**
 * @param {string | null} page The `tether-account-link` value.
 * @returns {string} The configured page for it, else the shop's account.
 */
function shopifyPageUrl(page) {
  const account = cfg.account;
  const fallback = `https://${cfg.domain}/account`;
  if (page === 'payment') return account?.paymentUrl || account?.subscriptionsUrl || fallback;
  if (page === 'subscriptions') return account?.subscriptionsUrl || fallback;
  return fallback;
}

/**
 * Fills the account markup in `root`: what shows when logged in or out, the customer, their orders, and the account
 * pages.
 *
 * @param {ParentNode} [root]
 * @returns {Promise<void>}
 */
export async function render(root = document) {
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
 *
 * @param {ParentNode} root
 */
async function bindCustomer(root) {
  const binds = qsa(root, sel('account-bind'));
  if (!binds.length) return;
  /** @type {AccountCustomer | null} */
  let profile;
  try {
    profile = await customer();
  } catch (error) {
    reportError(error, 'account');
    return;
  }
  if (!profile) return;
  /** @type {Record<string, string | null | undefined>} */
  const texts = {
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

/** @type {Promise<Parts['account-pages']> | null} */
let pagesPart = null;

/** @returns {Promise<Parts['account-pages']>} The account pages part, sharing this part's session. */
function pages() {
  pagesPart ??= loadPart('account-pages').then((part) => {
    part.setup({ serverFetch, customer, bindCustomer, reset: forgetServerLogin });
    return part;
  });
  return pagesPart;
}

/**
 * One of the customer's orders, in full (lines, totals, addresses, fulfillments, returns).
 *
 * @param {string | number} id
 */
export const order = (id) => pages().then((part) => part.order(id));
/** @param {{ firstName?: string, lastName?: string }} [fields] */
export const updateProfile = (fields) => pages().then((part) => part.updateProfile(fields));
export const addresses = () => pages().then((part) => part.addresses());
/**
 * Creates an address, or updates the one with `id`.
 *
 * @param {AddressFields | null} address
 * @param {{ id?: string, isDefault?: boolean }} [options]
 */
export const saveAddress = (address, options) => pages().then((part) => part.saveAddress(address, options));
/** @param {string} id */
export const deleteAddress = (id) => pages().then((part) => part.deleteAddress(id));
export const subscriptions = () => pages().then((part) => part.subscriptions());
/**
 * @param {string | number} id
 * @param {SubscriptionAction} action
 */
export const subscriptionAction = (id, action) => pages().then((part) => part.subscriptionAction(id, action));
/**
 * @param {string | number} orderId
 * @param {ReturnLine[]} lines
 */
export const requestReturn = (orderId, lines) => pages().then((part) => part.requestReturn(orderId, lines));

/** @param {MouseEvent} event */
function onClick(event) {
  const target = event.target;
  if (!(target instanceof window.Element)) return;
  if (target.closest(sel('account-login'))) {
    event.preventDefault();
    login().catch((/** @type {unknown} */ error) => {
      reportError(error, 'login');
    });
  } else if (target.closest(sel('account-logout'))) {
    event.preventDefault();
    logout().catch((/** @type {unknown} */ error) => {
      reportError(error, 'logout');
    });
  }
}

/**
 * Back from the Worker's login (`?account=`): drops the mark and sends `tether:account-login`, or
 * `tether:account-error` with the outcome as its `error` when the login didn't finish.
 */
function finishServerLogin() {
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
 *
 * @param {ParentNode} [root]
 * @returns {Promise<void>}
 */
export async function mountAccount(root = document) {
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
