/**
 * Browser mode (`account.clientId`): the login runs between this browser and Shopify, OAuth with PKCE, and the tokens
 * stay in this browser (sessionStorage, or localStorage with `account.remember`). The cart is linked to the customer,
 * so checkout knows them. No other server sees the customer's data.
 */
import { cfg, reportError } from '../config.js';
import { TetherError } from '../client.js';
import { emit } from '../dom.js';
import { Cart } from '../cart.js';
import { randomToken, toBase64Url } from '../../server/src/shared/base64url.js';
import {
  isRecord,
  loginCountry,
  loginLanguage,
  navigate,
  pendingLoginKey,
  readJsonIfAllowed,
  readJsonObjectOrEmpty,
  sessionArea,
  sessionKey,
  textOrNull,
  writeJsonIfAllowed,
} from './shared.js';
import { answersLogin, discover, requestToken } from './shopify-auth.js';
import { CUSTOMER_QUERY } from '../../server/src/shared/account-documents.js';
/** @import { TokenAnswer } from './shopify-auth.js' */

/**
 * @typedef {object} BrowserSession The customer's tokens, as kept in storage.
 * @property {string} access The Customer Account API access token.
 * @property {number} expiresAt When `access` is to be refreshed, in milliseconds since the epoch.
 * @property {string | null} refresh
 * @property {string | null} idToken For Shopify's logout.
 */
/**
 * @typedef {object} PendingLogin What the callback checks Shopify's answer against.
 * @property {string} state
 * @property {string} nonce
 * @property {string} verifier The PKCE code verifier.
 * @property {string} redirect The callback URL the authorization request named.
 * @property {string} returnTo
 * @property {number} at When the visitor left for Shopify, in milliseconds since the epoch.
 */

/** An access token is refreshed this long before Shopify says it expires, so a request never carries a dead one. */
const REFRESH_MARGIN_SECONDS = 120;
/** A login that comes back later than this is refused: its `state` and verifier have been lying in storage. */
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * @typedef {object} AccountCustomer The customer as `CUSTOMER_QUERY` (account-ops.js) reads them.
 * @property {string} [id] Left out in server mode, whose Worker keeps the id to itself.
 * @property {string | null} firstName
 * @property {string | null} lastName
 * @property {string | null} displayName
 * @property {{ emailAddress: string | null } | null} emailAddress
 * @property {{ formatted: string[] | null } | null} defaultAddress
 */

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

/**
 * @param {unknown} value
 * @returns {PendingLogin | null}
 */
function toPendingLogin(value) {
  if (!isRecord(value)) return null;
  const { state, nonce, verifier, redirect, returnTo, at } = value;
  if (typeof state !== 'string' || typeof nonce !== 'string' || typeof verifier !== 'string') return null;
  if (typeof redirect !== 'string' || typeof returnTo !== 'string' || typeof at !== 'number') return null;
  return { state, nonce, verifier, redirect, returnTo, at };
}

/** @returns {BrowserSession | null} The session of this page, else the stored one. */
const currentSession = () => session ?? toSession(readJsonIfAllowed(sessionArea(), sessionKey()));

/** @returns {string | null} The session's access token, which a refresh may have replaced or ended. */
const accessToken = () => session?.access ?? null;

/** @returns {boolean} True while there is an access token that hasn't expired, or a refresh token. */
export const hasBrowserLogin = () =>
  Boolean(session && (session.refresh || (session.access && session.expiresAt > Date.now())));

/**
 * @returns {string} The configured client id.
 * @throws {TetherError} `NOT_CONFIGURED` without one.
 */
function clientId() {
  const id = cfg.account?.clientId;
  if (!id) throw new TetherError('Customer accounts: set account.clientId', { code: 'NOT_CONFIGURED' });
  return id;
}

/** @param {string} text */
const sha256 = async (text) => toBase64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/**
 * To Shopify's login page; the visitor comes back to `account.callbackUrl` (default: this page).
 *
 * @param {{ returnTo: string, locale?: string | undefined }} options
 * @throws {TetherError} `NOT_CONFIGURED` without `account.clientId`.
 */
export async function browserLoginRedirect({ returnTo, locale }) {
  const client = clientId();
  const endpoints = await discover();
  /** @type {PendingLogin} */
  const pending = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    redirect: cfg.account?.callbackUrl || `${window.location.origin}${window.location.pathname}`,
    returnTo,
    at: Date.now(),
  };
  writeJsonIfAllowed('session', pendingLoginKey(), pending);
  const url = new URL(endpoints.authorizationEndpoint);
  /** @type {Record<string, string>} */
  const params = {
    client_id: client,
    scope: 'openid email customer-account-api:full',
    response_type: 'code',
    redirect_uri: pending.redirect,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: await sha256(pending.verifier),
    code_challenge_method: 'S256',
  };
  const language = loginLanguage(locale);
  if (language) params['locale'] = language;
  const country = loginCountry();
  if (country) params['region_country'] = country;
  Object.entries(params).forEach(([name, value]) => {
    url.searchParams.set(name, value);
  });
  navigate(url.toString());
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
 * On the callback page: finishes the login Shopify sends back (`?code=&state=`), and goes on to its `returnTo`.
 * Sends `tether:account-login`, or `tether:account-error` with Shopify's `error`.
 *
 * @returns {Promise<boolean>} True when a login finished.
 * @throws {TetherError} When the login took too long, or Shopify's answer doesn't check out.
 */
export async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const pending = toPendingLogin(readJsonIfAllowed('session', pendingLoginKey()));
  if (!pending || (!params.has('code') && !params.has('error')) || params.get('state') !== pending.state) return false;
  writeJsonIfAllowed('session', pendingLoginKey(), null);
  const clean = new URL(window.location.href);
  ['code', 'state', 'iss', 'error', 'error_description'].forEach((name) => {
    clean.searchParams.delete(name);
  });
  window.history.replaceState(window.history.state, '', clean);
  const error = params.get('error');
  if (error !== null) {
    emit('account-error', { error });
    return false;
  }
  if (Date.now() - pending.at > LOGIN_TIMEOUT_MS) {
    throw new TetherError('Customer accounts: the login took too long, please try again');
  }
  const client = clientId();
  const answer = await requestToken({
    grant_type: 'authorization_code',
    client_id: client,
    redirect_uri: pending.redirect,
    code: params.get('code') ?? '',
    code_verifier: pending.verifier,
  });
  const { issuer } = await discover();
  if (!answersLogin(answer.idToken, { nonce: pending.nonce, issuer, client })) {
    throw new TetherError('Customer accounts: the login answer did not check out (nonce/issuer/audience)');
  }
  keep(answer, null);
  await linkCart();
  emit('account-login', {});
  const back = pending.returnTo ? new URL(pending.returnTo, window.location.href) : null;
  if (back?.origin === window.location.origin && back.href !== clean.href) navigate(back.href);
  return true;
}

/** Forgets the session here; the next `getToken()` is `null`. */
function endSession() {
  session = null;
  customerProfile = null;
  writeJsonIfAllowed(sessionArea(), sessionKey(), null);
  Cart.setCustomer({ accessToken: null });
}

/** @param {BrowserSession} expired A session with a refresh token. */
async function refresh(expired) {
  try {
    const answer = await requestToken({
      grant_type: 'refresh_token',
      client_id: clientId(),
      refresh_token: expired.refresh ?? '',
    });
    keep(answer, expired);
    await linkCart();
  } catch (error) {
    if (error instanceof TetherError && error.code === 'SESSION_ENDED') endSession();
    else throw error;
  }
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
  if (session.access && session.expiresAt > Date.now()) return session.access;
  if (!session.refresh) {
    endSession();
    return null;
  }
  const expired = session;
  refreshing ??= refresh(expired).finally(() => {
    refreshing = null;
  });
  await refreshing;
  return accessToken();
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
 * @template T The shape of the query's `data`, which the query text decides.
 * @param {string} document
 * @param {Record<string, unknown>} [variables]
 * @returns {Promise<T>}
 * @throws {TetherError} `NOT_LOGGED_IN` without a login, `HTTP_<status>` for a failed request or GraphQL errors.
 */
export async function query(document, variables = {}) {
  const token = await getToken();
  if (!token) throw new TetherError('Not logged in', { code: 'NOT_LOGGED_IN' });
  const { graphql } = await discover();
  /** @param {string} accessToken */
  const send = (accessToken) =>
    fetch(graphql, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: accessToken },
      body: JSON.stringify({ query: document, variables }),
    });
  let response = await send(token);
  if (response.status === 401 && session?.refresh) {
    session.expiresAt = 0;
    response = await send((await getToken()) ?? '');
  }
  const json = await readJsonObjectOrEmpty(response);
  const errors = Array.isArray(json['errors']) ? json['errors'] : [];
  if (!response.ok || errors.length) {
    const messages = errors.map((error) => (isRecord(error) ? textOrNull(error['message']) : null)).filter(Boolean);
    throw new TetherError(messages.join(' | ') || `Customer accounts: ${response.status}`, {
      status: response.status,
    });
  }
  // The query text decides the shape of `data`; the caller's `T` states it.
  return /** @type {T} */ (json['data']);
}

/**
 * @returns {Promise<AccountCustomer | null>} The logged-in customer, asked once.
 * @throws {TetherError} As `query`.
 */
export async function browserCustomer() {
  if (customerProfile) return customerProfile;
  /** @type {{ customer: AccountCustomer | null }} */
  const data = await query(CUSTOMER_QUERY);
  customerProfile = data.customer;
  return customerProfile;
}

/** Asks Shopify again on the next `browserCustomer()`, after a change of the customer's data. */
export function forgetBrowserCustomer() {
  customerProfile = null;
}
