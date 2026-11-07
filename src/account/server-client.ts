/**
 * The browser's side of the Worker's account routes (`account.server`). The Worker holds the Shopify tokens, and
 * this browser only a session cookie its scripts can't read; what it keeps itself is the "may be logged in" hint,
 * which holds no secret. Storage throws in private mode and where the visitor blocks site data: the hint is then
 * not kept, and only pages with account markup load the part.
 */
import { cfg } from '../config.ts';
import { TetherError, withTimeout } from '../client.ts';
import { Cart } from '../cart.ts';
import { emit } from '../dom.ts';
import { isRecord, textOrNull } from '../../server/src/shared/json.ts';
import { messageOf } from '../../server/src/shared/error-message.ts';
import { hintKey } from '../account-marks.ts';
import { removeStored, setStored } from '../storage.ts';
import { toAccountCustomer, toUserErrors } from './answers.ts';
import type { AccountCustomer } from './answers.ts';

/** The Worker's answer, or a 401: the session cookie is missing, has expired, or Shopify ended the login. */
export type ServerAnswer = { kind: 'answer'; data: Record<string, unknown> } | { kind: 'logged-out' };
type ServerLogin = { loggedIn: true; customer: AccountCustomer } | { loggedIn: false };
export interface ServerRequest {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
}

/** The Worker's `/me` answer, until a change of the customer's data. */
let known: ServerLogin | null = null;

/**
 * @returns The Worker's account routes, without a trailing slash. `account.server` is a full URL or a path on this
 *   site.
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`.
 */
function serverBase(): string {
  const server = cfg.account?.server;
  if (!server) {
    throw new TetherError('Customer accounts need the Worker: set account.server', { code: 'NOT_CONFIGURED' });
  }
  return new URL(server, window.location.href).href.replace(/\/$/, '');
}

/**
 * Keeps the hint that makes the core load the part on the next page; without storage it is not kept (see the file's
 * comment).
 */
function setLoginHint(loggedIn: boolean): void {
  if (loggedIn) setStored(hintKey(), '1');
  else removeStored(hintKey());
}

/** An error page that isn't JSON reads as an empty answer: the response's status then says what went wrong. */
async function readJsonObjectOrEmpty(response: Response): Promise<Record<string, unknown>> {
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    // Any other error is the connection failing, or the time limit aborting, while the body streams in.
    if (error instanceof SyntaxError) return {};
    throw error;
  }
  return isRecord(json) ? json : {};
}

/**
 * The Worker's response and its JSON body, under `requestTimeout` like a Storefront request: a Worker that stalls
 * would otherwise hold the Checkout button busy for as long as the browser keeps the connection open.
 *
 * @throws {TetherError} `NETWORK` when the request or its body fails, or the whole answer takes too long.
 */
async function fetchFromWorker(
  url: string,
  init: RequestInit,
): Promise<{ response: Response; data: Record<string, unknown> }> {
  try {
    return await withTimeout(cfg.requestTimeout, async (signal) => {
      const response = await fetch(url, { ...init, signal });
      return { response, data: await readJsonObjectOrEmpty(response) };
    });
  } catch (error) {
    throw new TetherError(`Network error: ${messageOf(error)}`, {
      code: 'NETWORK',
    });
  }
}

/**
 * One request to the Worker, with the session cookie. A POST carries the header the Worker requires against
 * cross-site forms.
 *
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`, `INVALID` for refused input, `HTTP_<status>` for
 *   any other failure but a 401, with the Worker's `userErrors`; `NETWORK` when the Worker can't be reached or takes
 *   longer than `requestTimeout`.
 */
export async function serverFetch(path: string, { method = 'GET', body }: ServerRequest = {}): Promise<ServerAnswer> {
  const init: RequestInit = { method, credentials: 'include' };
  if (method === 'POST') init.headers = { 'Content-Type': 'application/json', 'X-Tether-Account': '1' };
  if (body) init.body = JSON.stringify(body);
  const { response, data } = await fetchFromWorker(`${serverBase()}${path}`, init);
  if (response.status === 401) return { kind: 'logged-out' };
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
 * @throws {TetherError} When the Worker can't be reached or fails: that says nothing about the login.
 */
export async function serverLogin(): Promise<ServerLogin> {
  if (!known) {
    const answer = await serverFetch('/me');
    known =
      answer.kind === 'answer' && answer.data['loggedIn'] === true
        ? { loggedIn: true, customer: toAccountCustomer(answer.data['customer']) }
        : { loggedIn: false };
  }
  setLoginHint(known.loggedIn);
  return known;
}

/** @returns True when the Worker last said a customer is logged in. */
export const isServerLoggedIn = (): boolean => known?.loggedIn === true;

/** Asks the Worker again on the next `serverLogin()`, after a change of the customer's data. */
export function forgetServerLogin(): void {
  known = null;
}

/** Goes to the Worker's (or Shopify's) pages, through `account.navigate` when the site replaces the redirect. */
function navigate(url: string): void {
  const replacement = cfg.account?.navigate;
  if (replacement) replacement(url);
  else window.location.assign(url);
}

/**
 * @param locale The caller's choice.
 * @returns The language of Shopify's login page: the caller's, `account.locale`, else the site's; `''` for Shopify's
 *   default.
 */
const loginLanguage = (locale: string | undefined): string =>
  locale || cfg.account?.locale || (cfg.locale || '').split('-')[0] || '';

/**
 * To the Worker's login, which comes back to `returnTo` with `?account=<outcome>`. The cart is linked later, at
 * checkout, through the Worker's protected `POST /cart`.
 *
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`.
 */
export function serverLoginRedirect({ returnTo, locale }: { returnTo: string; locale?: string | undefined }): void {
  const url = new URL(`${serverBase()}/login`);
  url.searchParams.set('returnTo', returnTo);
  const language = loginLanguage(locale);
  if (language) url.searchParams.set('locale', language);
  if (cfg.country) url.searchParams.set('country', cfg.country.toUpperCase());
  navigate(url.toString());
}

/**
 * The logged-in customer's checkout, for `Cart.setCheckoutResolver`: the Worker links the cart to the customer and
 * answers with its checkout URL.
 *
 * @returns `null` when nobody is logged in or the Worker linked no cart, so the cart's own checkout URL is used.
 * @throws {TetherError} When the Worker fails; the cart reports it and checks out without the login.
 */
export async function serverCheckoutUrl(): Promise<string | null> {
  const cartId = Cart.id();
  if (!(await serverLogin()).loggedIn || !cartId) return null;
  const answer = await serverFetch('/cart', { method: 'POST', body: { cartId } });
  if (answer.kind === 'logged-out') return null;
  return textOrNull(answer.data['checkoutUrl']);
}

/**
 * Ends the session at the Worker, which also unlinks the cart, then goes on to Shopify's logout when the Worker says
 * where. Sends `tether:account-logout`.
 */
export async function serverLogout(returnTo: string): Promise<'redirected' | 'stayed'> {
  const answer = await serverFetch('/logout', { method: 'POST', body: { returnTo, cartId: Cart.id() } });
  known = null;
  setLoginHint(false);
  emit('account-logout', {});
  const logoutUrl = answer.kind === 'answer' ? textOrNull(answer.data['logoutUrl']) : null;
  if (!logoutUrl) return 'stayed';
  navigate(logoutUrl);
  return 'redirected';
}
