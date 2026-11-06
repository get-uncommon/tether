/**
 * Server mode (`account.server`): the site's Worker holds the Shopify tokens, and this browser only a session cookie
 * its scripts can't read. This module is the browser's side of the Worker's account routes.
 */
import { cfg } from '../config.js';
import { TetherError } from '../client.js';
import { Cart } from '../cart.js';
import { emit } from '../dom.js';
import { accountFetch, loginCountry, loginLanguage, navigate, readJsonObjectOrEmpty, setLoginHint } from './shared.js';
import { textOrNull } from '../../server/src/shared/json.js';
import { toServerCustomer, toUserErrors } from './answers.js';
/** @import { AccountCustomer } from './answers.js' */

/**
 * @typedef {{ kind: 'answer', data: Record<string, unknown> } | { kind: 'logged-out' }} ServerAnswer The Worker's
 *   answer, or a 401: the session cookie is missing, has expired, or Shopify ended the login.
 */
/** @typedef {{ loggedIn: true, customer: AccountCustomer } | { loggedIn: false }} ServerLogin */
/** @typedef {{ method?: 'GET' | 'POST', body?: Record<string, unknown> }} ServerRequest */

/** @type {ServerLogin | null} The Worker's `/me` answer, until a change of the customer's data. */
let known = null;

/**
 * @returns {string} The Worker's account routes, without a trailing slash; `''` in browser mode. `account.server` is a
 *   full URL or a path on this site.
 */
export function serverBase() {
  const server = cfg.account?.server;
  if (!server) return '';
  return new URL(server, window.location.href).href.replace(/\/$/, '');
}

/**
 * One request to the Worker, with the session cookie. A POST carries the header the Worker requires against
 * cross-site forms.
 *
 * @param {string} path
 * @param {ServerRequest} [request]
 * @returns {Promise<ServerAnswer>}
 * @throws {TetherError} `INVALID` for refused input, `HTTP_<status>` for any other failure but a 401, with the
 *   Worker's `userErrors`; `NETWORK` when the Worker can't be reached.
 */
export async function serverFetch(path, { method = 'GET', body } = {}) {
  /** @type {RequestInit} */
  const init = { method, credentials: 'include' };
  if (method === 'POST') init.headers = { 'Content-Type': 'application/json', 'X-Tether-Account': '1' };
  if (body) init.body = JSON.stringify(body);
  const response = await accountFetch(`${serverBase()}${path}`, init);
  if (response.status === 401) return { kind: 'logged-out' };
  const data = await readJsonObjectOrEmpty(response);
  if (!response.ok) {
    const reason = textOrNull(data['error']) ?? String(response.status);
    const userErrors = toUserErrors(data['userErrors']);
    throw new TetherError(`Customer accounts: ${reason}`, {
      status: response.status,
      ...(userErrors.length > 0 && { userErrors }),
      // The Worker marks refused input (a 400, or a 404 for a contract that isn't the customer's) with `code`.
      ...(data['code'] === 'INVALID' && { code: 'INVALID' }),
    });
  }
  return { kind: 'answer', data };
}

/**
 * Who is logged in, asked once and then kept; the "may be logged in" hint follows the answer.
 *
 * @returns {Promise<ServerLogin>}
 * @throws {TetherError} When the Worker can't be reached or fails: that says nothing about the login.
 */
export async function serverLogin() {
  if (!known) {
    const answer = await serverFetch('/me');
    known =
      answer.kind === 'answer' && answer.data['loggedIn'] === true
        ? { loggedIn: true, customer: toServerCustomer(answer.data['customer']) }
        : { loggedIn: false };
  }
  setLoginHint(known.loggedIn);
  return known;
}

/** @returns {boolean} True when the Worker last said a customer is logged in. */
export const isServerLoggedIn = () => known?.loggedIn === true;

/** Asks the Worker again on the next `serverLogin()`, after a change of the customer's data. */
export function forgetServerLogin() {
  known = null;
}

/**
 * To the Worker's login, which comes back to `returnTo`. The cart is linked later, at checkout, through the Worker's
 * protected `POST /cart`.
 *
 * @param {{ returnTo: string, locale?: string | undefined }} options
 */
export function serverLoginRedirect({ returnTo, locale }) {
  const url = new URL(`${serverBase()}/login`);
  url.searchParams.set('returnTo', returnTo);
  const language = loginLanguage(locale);
  if (language) url.searchParams.set('locale', language);
  const country = loginCountry();
  if (country) url.searchParams.set('country', country);
  navigate(url.toString());
}

/**
 * The logged-in customer's checkout, for `Cart.beforeCheckout`: the Worker links the cart to the customer and answers
 * with its checkout URL.
 *
 * @returns {Promise<string | null>} `null` when nobody is logged in or the Worker linked no cart, so the cart's own
 *   checkout URL is used.
 * @throws {TetherError} When the Worker fails; the cart reports it and checks out without the login.
 */
export async function serverCheckoutUrl() {
  const cartId = Cart.id();
  if (!(await serverLogin()).loggedIn || !cartId) return null;
  const answer = await serverFetch('/cart', { method: 'POST', body: { cartId } });
  if (answer.kind === 'logged-out') return null;
  const url = textOrNull(answer.data['checkoutUrl']);
  if (!url) return null;
  return `${url}${url.includes('?') ? '&' : '?'}logged_in=true`;
}

/**
 * Ends the session at the Worker, which also unlinks the cart, then goes on to Shopify's logout when the Worker says
 * where. Sends `tether:account-logout`.
 *
 * @param {string} returnTo
 * @returns {Promise<'redirected' | 'stayed'>}
 */
export async function serverLogout(returnTo) {
  const answer = await serverFetch('/logout', { method: 'POST', body: { returnTo, cartId: Cart.id() } });
  known = null;
  setLoginHint(false);
  emit('account-logout', {});
  const logoutUrl = answer.kind === 'answer' ? textOrNull(answer.data['logoutUrl']) : null;
  if (!logoutUrl) return 'stayed';
  navigate(logoutUrl);
  return 'redirected';
}
