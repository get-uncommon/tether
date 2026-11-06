/**
 * Customer accounts (Shopify Customer Account API), as an optional part: loaded only when `account` is configured
 * and the page uses it, or a login is in progress, or the visitor may be logged in.
 *
 *   window.TETHER_CONFIG = { …, account: { server: '/_tether/account' } }  // or { clientId: '…' } for browser mode
 *
 *   <button tether-account-login>Log in</button>
 *   <button tether-account-logout tether-show="logged-in">Log out</button>
 *   <span tether-account-bind="first-name"></span>             first-name, last-name, name, email, address
 *   <div tether-orders>                                       the customer's orders (first child = template)
 *     <a tether-order-bind="url"><span tether-order-bind="name"></span> · <span tether-order-bind="date"></span></a>
 *   </div>
 *   <p tether-show="logged-out">…</p>
 *
 * Two modes, one interface: server mode (`account/server-client.js`), where the site's Worker holds the tokens, and
 * browser mode (`account/browser-session.js`), where this browser does the OAuth login itself. Shopify needs HTTPS
 * (no localhost: use a tunnel) and the site's origin, callback and logout URLs registered in the Headless channel's
 * Customer Account API settings. The order page, profile, addresses, subscriptions and returns are the
 * `account-pages` part, loaded only on pages that use them.
 */
import { cfg, log, reportError } from './config.js';
import { TetherError } from './client.js';
import { sel, get, qsa, setText, show, emit } from './dom.js';
import { Cart } from './cart.js';
import { loadPart } from './lazy.js';
import { ORDERS_QUERY } from '../server/src/shared/account-documents.js';
import {
  browserCustomer,
  browserLoginRedirect,
  browserLogout,
  forgetBrowserCustomer,
  getToken,
  handleCallback,
  hasBrowserLogin,
  query as browserQuery,
} from './account/browser-session.js';
import {
  forgetServerLogin,
  isServerLoggedIn,
  serverBase,
  serverCheckoutUrl,
  serverFetch,
  serverLogin,
  serverLoginRedirect,
  serverLogout,
} from './account/server-client.js';
import { renderOrderList } from './account/order-list.js';
import { ownValue } from './account/markup.js';
/** @import { AccountCustomer } from './account/browser-session.js' */
/** @import { AccountOrder } from './account/order-list.js' */
/** @import { Parts } from './lazy.js' */
/** @import { AddressFields, ReturnLine } from './account/operations.js' */
/** @import { SubscriptionAction } from '../server/src/shared/account-ops.js' */

export { getToken, handleCallback };

/**
 * @typedef {{ kind: 'logged-in' } | { kind: 'logged-out' } | { kind: 'unknown', error: unknown }} LoginState
 *   `unknown` when the Worker or Shopify can't say: the page shows its logged-out content, and the account pages their
 *   error state.
 */

/** The attributes of the account pages, which are their own part. */
const PAGE_ATTRIBUTES = ['order', 'addresses', 'subscriptions', 'profile-form', 'address-form'];

/** @returns {boolean} True while a customer is logged in, as far as this page knows without asking. */
export function isLoggedIn() {
  return serverBase() ? isServerLoggedIn() : hasBrowserLogin();
}

/**
 * To Shopify's login page; the visitor comes back to `account.callbackUrl` (default: this page).
 *
 * @param {{ returnTo?: string, locale?: string }} [options]
 * @returns {Promise<void>}
 * @throws {TetherError} `NOT_CONFIGURED` in browser mode without `account.clientId`.
 */
export async function login({ returnTo = window.location.href, locale } = {}) {
  if (serverBase()) serverLoginRedirect({ returnTo, locale });
  else await browserLoginRedirect({ returnTo, locale });
}

/**
 * Any Customer Account API query, in browser mode.
 *
 * @template T The shape of the query's `data`.
 * @param {string} document
 * @param {Record<string, unknown>} [variables]
 * @returns {Promise<T>}
 * @throws {TetherError} `NOT_ALLOWED` in server mode, which answers only its fixed operations; `NOT_LOGGED_IN`.
 */
export async function query(document, variables = {}) {
  if (serverBase()) {
    throw new TetherError('Customer accounts in server mode only answer customer() and orders()', {
      code: 'NOT_ALLOWED',
    });
  }
  return browserQuery(document, variables);
}

/** @returns {Promise<AccountCustomer | null>} The logged-in customer, `null` when nobody is. */
export async function customer() {
  if (!serverBase()) return browserCustomer();
  const me = await serverLogin();
  if (!me.loggedIn) return null;
  return {
    ...me.customer,
    emailAddress: { emailAddress: me.customer.email },
    defaultAddress: { formatted: me.customer.address },
  };
}

/**
 * @param {{ first?: number }} [options]
 * @returns {Promise<AccountOrder[]>} The customer's most recent orders, newest first; none when nobody is logged in
 *   (server mode).
 */
export async function orders({ first = 10 } = {}) {
  if (serverBase()) {
    const answer = await serverFetch(`/orders?first=${first}`);
    if (answer.kind === 'logged-out') return [];
    const list = answer.data['orders'];
    // The Worker sends the nodes of the same `ORDERS_QUERY`.
    return Array.isArray(list) ? /** @type {AccountOrder[]} */ (list) : [];
  }
  /** @type {{ customer: { orders: { nodes: AccountOrder[] } } | null }} */
  const data = await browserQuery(ORDERS_QUERY, { first });
  return data.customer?.orders.nodes ?? [];
}

/**
 * Logs out here and at Shopify, and unlinks the cart. Sends `tether:account-logout`.
 *
 * @param {{ returnTo?: string }} [options] Where Shopify sends the visitor afterwards.
 * @returns {Promise<void>}
 */
export async function logout({ returnTo = cfg.account?.logoutUrl || `${window.location.origin}/` } = {}) {
  const outcome = serverBase() ? await serverLogout(returnTo) : await browserLogout(returnTo);
  if (outcome === 'stayed') await render(document);
}

/** @returns {Promise<LoginState>} */
async function loginState() {
  try {
    if (serverBase()) return (await serverLogin()).loggedIn ? { kind: 'logged-in' } : { kind: 'logged-out' };
    if (hasBrowserLogin() || (await getToken())) return { kind: 'logged-in' };
    return { kind: 'logged-out' };
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
  const account = cfg.account;
  qsa(root, sel('account-link')).forEach((link) => {
    const page = get(link, 'account-link');
    const subscriptions = account?.subscriptionsUrl;
    const url =
      (page === 'payment' && (account?.paymentUrl || subscriptions)) || (page === 'subscriptions' && subscriptions);
    link.setAttribute('href', url || `https://${cfg.domain}/account`);
  });
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
  const profile = await customer().catch((/** @type {unknown} */ error) => {
    reportError(error, 'account');
    return null;
  });
  /** @type {Record<string, string | null | undefined>} */
  const texts = {
    'first-name': profile?.firstName,
    'last-name': profile?.lastName,
    name: profile?.displayName,
    email: profile?.emailAddress?.emailAddress,
    address: profile?.defaultAddress?.formatted?.join(', '),
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
    part.setup({
      serverBase,
      serverFetch,
      query,
      customer,
      bindCustomer,
      reset: () => {
        forgetBrowserCustomer();
        forgetServerLogin();
      },
    });
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

/** Back from the Worker's login (`?account=in`): drops the mark, and lets the Worker link the cart at checkout. */
function startServerMode() {
  const url = new URL(window.location.href);
  if (url.searchParams.get('account')) {
    url.searchParams.delete('account');
    window.history.replaceState(window.history.state, '', url);
    emit('account-login', {});
  }
  Cart.setCustomer({ beforeCheckout: serverCheckoutUrl });
}

/** Finishes a login that's coming back from Shopify, and links the cart of a customer who is logged in. */
async function startBrowserMode() {
  try {
    await handleCallback();
  } catch (error) {
    reportError(error, 'login');
  }
  if (Cart.customerAccessToken) return;
  try {
    const accessToken = await getToken();
    if (accessToken) Cart.setCustomer({ accessToken });
  } catch (error) {
    reportError(error, 'account');
  }
}

let started = false;

/**
 * Called by the core on mount: on the first one, finishes a login that's coming back; then fills the page.
 *
 * @param {ParentNode} [root]
 * @returns {Promise<void>}
 */
export async function mountAccount(root = document) {
  if (!started) {
    started = true;
    document.addEventListener('click', onClick);
    if (serverBase()) startServerMode();
    else await startBrowserMode();
    log('account', isLoggedIn() ? 'logged in' : 'logged out');
  }
  await render(root);
}
