/**
 * Browser mode's session (`account.clientId`): the login (browser-login.js) runs between this browser and Shopify,
 * and the tokens stay in this browser, in the storage area `sessionArea()` (shared.js) chooses. This module keeps
 * and refreshes them, links the cart to the customer so checkout knows them, and asks the Customer Account API. No
 * other server sees the customer's data.
 */
import { cfg, reportError } from '../config.js';
import { TetherError } from '../client.js';
import { emit } from '../dom.js';
import { Cart } from '../cart.js';
import { field, isRecord } from '../../server/src/shared/json.js';
import {
  accountFetch,
  navigate,
  readJsonIfAllowed,
  readJsonObjectOrEmpty,
  sessionArea,
  sessionKey,
  textOrNull,
  writeJsonIfAllowed,
} from './shared.js';
import { discover, requestToken } from './shopify-auth.js';
import { CUSTOMER_QUERY, ORDERS_QUERY } from '../../server/src/shared/account-documents.js';
import { toAccountCustomer, toAccountOrders } from './answers.js';
/** @import { TokenAnswer } from './shopify-auth.js' */
/** @import { AccountCustomer, AccountOrder } from './answers.js' */

/**
 * @typedef {object} BrowserSession The customer's tokens, as kept in storage.
 * @property {string} access The Customer Account API access token.
 * @property {number} expiresAt When `access` is to be refreshed, in milliseconds since the epoch.
 * @property {string | null} refresh
 * @property {string | null} idToken For Shopify's logout.
 */
/** @typedef {{ kind: 'answer', data: unknown } | { kind: 'logged-out' }} CustomerAnswer */

/** An access token is refreshed this long before Shopify says it expires, so a request never carries a dead one. */
const REFRESH_MARGIN_SECONDS = 120;
/** Shopify's status for an access token it refuses. */
const UNAUTHORIZED = 401;

/** @type {BrowserSession | null} */
let session = null;
/** @type {AccountCustomer | null} The logged-in customer, until a change of their data or the end of the session. */
let customerProfile = null;
/** @type {Promise<void> | null} The refresh on its way: one at a time, whoever asks. */
let refreshing = null;

/**
 * @param {unknown} value
 * @returns {BrowserSession | null}
 */
function toSession(value) {
  if (!isRecord(value)) return null;
  const access = value['access'];
  const expiresAt = value['expiresAt'];
  if (typeof access !== 'string' || typeof expiresAt !== 'number') return null;
  return { access, expiresAt, refresh: textOrNull(value['refresh']), idToken: textOrNull(value['idToken']) };
}

/** @returns {BrowserSession | null} The session of this page, else the stored one. */
const currentSession = () => session ?? toSession(readJsonIfAllowed(sessionArea(), sessionKey()));

/** @returns {string | null} The session's access token, which a refresh may have replaced or ended. */
const accessToken = () => session?.access ?? null;

/** @returns {TetherError} */
const notLoggedIn = () => new TetherError('Not logged in', { code: 'NOT_LOGGED_IN' });

/**
 * @returns {boolean} True while this page or its storage holds an access token that hasn't expired, or a refresh
 *   token.
 */
export function hasBrowserLogin() {
  const known = currentSession();
  return known !== null && (known.refresh !== null || known.expiresAt > Date.now());
}

/**
 * @returns {string} The configured client id.
 * @throws {TetherError} `NOT_CONFIGURED` without one.
 */
export function clientId() {
  const id = cfg.account?.clientId;
  if (!id) throw new TetherError('Customer accounts: set account.clientId', { code: 'NOT_CONFIGURED' });
  return id;
}

/**
 * @param {TokenAnswer} answer
 * @param {BrowserSession | null} previous A refresh answer may leave out the refresh and id tokens: these are kept.
 */
function keep(answer, previous) {
  session = {
    access: answer.access,
    expiresAt: Date.now() + Math.max(0, answer.expiresInSeconds - REFRESH_MARGIN_SECONDS) * 1000,
    refresh: answer.refresh ?? previous?.refresh ?? null,
    idToken: answer.idToken ?? previous?.idToken ?? null,
  };
  writeJsonIfAllowed(sessionArea(), sessionKey(), session);
}

/**
 * Keeps the tokens of a login that just finished, and links the cart to the customer.
 *
 * @param {TokenAnswer} answer
 */
export async function startSession(answer) {
  keep(answer, null);
  await linkCart();
}

/** Forgets the session here; the next `getToken()` is `null`. */
function endSession() {
  session = null;
  customerProfile = null;
  writeJsonIfAllowed(sessionArea(), sessionKey(), null);
  Cart.setCustomer({ accessToken: null });
}

/**
 * @param {BrowserSession} expired
 * @param {string} refreshToken `expired`'s refresh token.
 */
async function refresh(expired, refreshToken) {
  try {
    const answer = await requestToken({
      grant_type: 'refresh_token',
      client_id: clientId(),
      refresh_token: refreshToken,
    });
    keep(answer, expired);
    await linkCart();
  } catch (error) {
    if (error instanceof TetherError && error.code === 'SESSION_ENDED') endSession();
    else throw error;
  }
}

/**
 * @param {BrowserSession} expired
 * @param {string} refreshToken
 * @returns {Promise<string | null>} The new access token, `null` when Shopify ended the login.
 */
async function refreshOnce(expired, refreshToken) {
  refreshing ??= refresh(expired, refreshToken).finally(() => {
    refreshing = null;
  });
  await refreshing;
  return accessToken();
}

/**
 * A valid access token: refreshed when needed, one refresh at a time.
 *
 * @returns {Promise<string | null>} `null` when nobody is logged in, or Shopify ended the login.
 * @throws {TetherError} When a refresh fails for another reason (the network): the login may still be good.
 */
export async function getToken() {
  session = currentSession();
  if (!session) return null;
  if (session.expiresAt > Date.now()) return session.access;
  if (session.refresh === null) {
    endSession();
    return null;
  }
  return refreshOnce(session, session.refresh);
}

/**
 * The token to retry with after Shopify refused `refused`: a refreshed one, once.
 *
 * @param {string} refused
 * @returns {Promise<string>}
 * @throws {TetherError} `NOT_LOGGED_IN` when the session can't be refreshed: it is over.
 */
async function tokenAfterRefusal(refused) {
  const current = session;
  if (current === null) throw notLoggedIn();
  if (current.access !== refused) return current.access;
  if (current.refresh === null) {
    endSession();
    throw notLoggedIn();
  }
  const token = await refreshOnce(current, current.refresh);
  if (!token) throw notLoggedIn();
  return token;
}

/** The customer's checkout is theirs: saved addresses, vaulted cards, the order in their order history. */
async function linkCart() {
  const token = accessToken();
  Cart.setCustomer({ accessToken: token });
  if (!Cart.id() || !token) return;
  try {
    await Cart.setBuyerIdentity({ customerAccessToken: token }, { create: false });
  } catch (error) {
    reportError(error, 'account cart');
  }
}

/**
 * Unlinks the cart, so the next person on this device doesn't check out as this customer. When Shopify can't be
 * told, the cart is forgotten here instead: the next visitor starts a new one.
 */
async function unlinkCart() {
  if (!Cart.id()) return;
  try {
    await Cart.setBuyerIdentity({ customerAccessToken: null }, { create: false });
  } catch (error) {
    reportError(error, 'account cart unlink');
    // The cart id is kept under the `storageKey` option. The cart's own module isn't shared with the parts of the
    // `<script>` build, so the id is removed here.
    writeJsonIfAllowed('local', cfg.storageKey, null);
  }
}

/**
 * Logs out here, unlinks the cart, then goes on to Shopify's logout. Sends `tether:account-logout`.
 *
 * @param {string} returnTo Where Shopify sends the visitor afterwards.
 * @returns {Promise<'redirected' | 'stayed'>} `stayed` without an id token, which Shopify's logout needs.
 */
export async function browserLogout(returnTo) {
  const idToken = currentSession()?.idToken ?? null;
  await unlinkCart();
  endSession();
  emit('account-logout', {});
  if (!idToken) return 'stayed';
  const url = new URL((await discover()).endSessionEndpoint);
  url.searchParams.set('id_token_hint', idToken);
  url.searchParams.set('post_logout_redirect_uri', returnTo);
  navigate(url.toString());
  return 'redirected';
}

/**
 * Any Customer Account API query, with the customer's token; a token Shopify refuses is refreshed once.
 *
 * @param {string} document
 * @param {Record<string, unknown>} [variables]
 * @returns {Promise<unknown>} The answer's `data`, whose shape the query text decides.
 * @throws {TetherError} `NOT_LOGGED_IN` without a login or when Shopify ended it, `NETWORK`, `HTTP_<status>` for a
 *   failed request or GraphQL errors.
 */
export async function query(document, variables = {}) {
  const token = await getToken();
  if (!token) throw notLoggedIn();
  const { graphql } = await discover();
  /** @param {string} accessTokenToSend */
  const send = (accessTokenToSend) =>
    accountFetch(graphql, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: accessTokenToSend },
      body: JSON.stringify({ query: document, variables }),
    });
  let response = await send(token);
  if (response.status === UNAUTHORIZED) response = await send(await tokenAfterRefusal(token));
  if (response.status === UNAUTHORIZED) {
    endSession();
    throw notLoggedIn();
  }
  const json = await readJsonObjectOrEmpty(response);
  const errors = Array.isArray(json['errors']) ? json['errors'] : [];
  if (!response.ok || errors.length) {
    const messages = errors.map((error) => textOrNull(field(error, 'message'))).filter((message) => message !== null);
    throw new TetherError(messages.join(' | ') || `Customer accounts: ${response.status}`, {
      status: response.status,
    });
  }
  return json['data'];
}

/**
 * `query`, with a missing or ended login as an answer: both modes treat it as "nobody is logged in".
 *
 * @param {string} document
 * @param {Record<string, unknown>} [variables]
 * @returns {Promise<CustomerAnswer>}
 * @throws {TetherError} As `query`, but for `NOT_LOGGED_IN`.
 */
async function askAsCustomer(document, variables) {
  try {
    return { kind: 'answer', data: await query(document, variables) };
  } catch (error) {
    if (error instanceof TetherError && error.code === 'NOT_LOGGED_IN') return { kind: 'logged-out' };
    throw error;
  }
}

/**
 * @returns {Promise<AccountCustomer | null>} The logged-in customer, asked once; `null` when nobody is.
 * @throws {TetherError} As `query`.
 */
export async function browserCustomer() {
  if (customerProfile) return customerProfile;
  const answer = await askAsCustomer(CUSTOMER_QUERY);
  if (answer.kind === 'logged-out') return null;
  customerProfile = toAccountCustomer(field(answer.data, 'customer'));
  return customerProfile;
}

/**
 * @param {number} first
 * @returns {Promise<AccountOrder[]>} The customer's most recent orders, newest first; none when nobody is logged in.
 * @throws {TetherError} As `query`.
 */
export async function browserOrders(first) {
  const answer = await askAsCustomer(ORDERS_QUERY, { first });
  if (answer.kind === 'logged-out') return [];
  return toAccountOrders(field(field(field(answer.data, 'customer'), 'orders'), 'nodes'));
}

/** Asks Shopify again on the next `browserCustomer()`, after a change of the customer's data. */
export function forgetBrowserCustomer() {
  customerProfile = null;
}
