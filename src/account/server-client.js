/**
 * The browser's side of the Worker's account routes (`account.server`). The Worker holds the Shopify tokens, and
 * this browser only a session cookie its scripts can't read; what it keeps itself is the "may be logged in" hint,
 * which holds no secret. Storage throws in private mode and where the visitor blocks site data: the hint is then
 * not kept, and only pages with account markup load the part.
 */
import { cfg } from '../config.js';
import { TetherError } from '../client.js';
import { Cart } from '../cart.js';
import { emit } from '../dom.js';
import { isRecord, textOrNull } from '../../server/src/shared/json.js';
import { hintKey } from '../account-marks.js';
import { toAccountCustomer, toUserErrors } from './answers.js';
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
 * @returns {string} The Worker's account routes, without a trailing slash. `account.server` is a full URL or a path
 *   on this site.
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`.
 */
function serverBase() {
  const server = cfg.account?.server;
  if (!server) {
    throw new TetherError('Customer accounts need the Worker: set account.server', { code: 'NOT_CONFIGURED' });
  }
  return new URL(server, window.location.href).href.replace(/\/$/, '');
}

/**
 * Keeps the hint that makes the core load the part on the next page; without storage it is not kept (see the file's
 * comment).
 *
 * @param {boolean} loggedIn
 */
function setLoginHintIfAllowed(loggedIn) {
  try {
    if (loggedIn) window.localStorage.setItem(hintKey(), '1');
    else window.localStorage.removeItem(hintKey());
  } catch {
    // Private mode or blocked storage: see the file's comment.
  }
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<Response>}
 * @throws {TetherError} `NETWORK` when the request fails before an answer.
 */
async function fetchFromWorker(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new TetherError(`Network error: ${error instanceof Error ? error.message : String(error)}`, {
      code: 'NETWORK',
    });
  }
}

/**
 * An error page that isn't JSON reads as an empty answer: the response's status then says what went wrong.
 *
 * @param {Response} response
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonObjectOrEmpty(response) {
  /** @type {unknown} */
  let json;
  try {
    json = await response.json();
  } catch {
    return {};
  }
  return isRecord(json) ? json : {};
}

/**
 * One request to the Worker, with the session cookie. A POST carries the header the Worker requires against
 * cross-site forms.
 *
 * @param {string} path
 * @param {ServerRequest} [request]
 * @returns {Promise<ServerAnswer>}
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`, `INVALID` for refused input, `HTTP_<status>` for
 *   any other failure but a 401, with the Worker's `userErrors`; `NETWORK` when the Worker can't be reached.
 */
export async function serverFetch(path, { method = 'GET', body } = {}) {
  /** @type {RequestInit} */
  const init = { method, credentials: 'include' };
  if (method === 'POST') init.headers = { 'Content-Type': 'application/json', 'X-Tether-Account': '1' };
  if (body) init.body = JSON.stringify(body);
  const response = await fetchFromWorker(`${serverBase()}${path}`, init);
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
        ? { loggedIn: true, customer: toAccountCustomer(answer.data['customer']) }
        : { loggedIn: false };
  }
  setLoginHintIfAllowed(known.loggedIn);
  return known;
}

/** @returns {boolean} True when the Worker last said a customer is logged in. */
export const isServerLoggedIn = () => known?.loggedIn === true;

/** Asks the Worker again on the next `serverLogin()`, after a change of the customer's data. */
export function forgetServerLogin() {
  known = null;
}

/**
 * Goes to the Worker's (or Shopify's) pages, through `account.navigate` when the site replaces the redirect.
 *
 * @param {string} url
 */
function navigate(url) {
  const replacement = cfg.account?.navigate;
  if (replacement) replacement(url);
  else window.location.assign(url);
}

/**
 * @param {string | undefined} locale The caller's choice.
 * @returns {string} The language of Shopify's login page: the caller's, `account.locale`, else the site's; `''` for
 *   Shopify's default.
 */
const loginLanguage = (locale) => locale || cfg.account?.locale || (cfg.locale || '').split('-')[0] || '';

/**
 * To the Worker's login, which comes back to `returnTo` with `?account=<outcome>`. The cart is linked later, at
 * checkout, through the Worker's protected `POST /cart`.
 *
 * @param {{ returnTo: string, locale?: string | undefined }} options
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`.
 */
export function serverLoginRedirect({ returnTo, locale }) {
  const url = new URL(`${serverBase()}/login`);
  url.searchParams.set('returnTo', returnTo);
  const language = loginLanguage(locale);
  if (language) url.searchParams.set('locale', language);
  if (cfg.country) url.searchParams.set('country', cfg.country.toUpperCase());
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
  setLoginHintIfAllowed(false);
  emit('account-logout', {});
  const logoutUrl = answer.kind === 'answer' ? textOrNull(answer.data['logoutUrl']) : null;
  if (!logoutUrl) return 'stayed';
  navigate(logoutUrl);
  return 'redirected';
}
