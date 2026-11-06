/**
 * Browser mode's login: the redirect to Shopify's login page (OAuth with PKCE), and the callback page that turns
 * Shopify's answer into a session (browser-session.js). Between the two, the pending login waits in
 * `sessionStorage`, in this tab only.
 */
import { cfg } from '../config.js';
import { TetherError } from '../client.js';
import { emit } from '../dom.js';
import { randomToken } from '../../server/src/shared/base64url.js';
import { authorizeUrl } from '../../server/src/shared/account-login.js';
import { isRecord } from '../../server/src/shared/json.js';
import { loginCountry, loginLanguage, navigate, readJsonIfAllowed, writeJsonIfAllowed } from './shared.js';
import { pendingLoginKey } from '../account-marks.js';
import { discover, loginAnswerProblem, requestToken } from './shopify-auth.js';
import { clientId, startSession } from './browser-session.js';

/**
 * @typedef {object} PendingLogin What the callback checks Shopify's answer against.
 * @property {string} state
 * @property {string} nonce
 * @property {string} verifier The PKCE code verifier.
 * @property {string} redirect The callback URL the authorization request named.
 * @property {string} returnTo
 * @property {number} at When the visitor left for Shopify, in milliseconds since the epoch.
 */

/** A login that comes back later than this is refused: its `state` and verifier have been lying in storage. */
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

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
  const url = await authorizeUrl(endpoints.authorizationEndpoint, {
    clientId: client,
    redirectUri: pending.redirect,
    state: pending.state,
    nonce: pending.nonce,
    verifier: pending.verifier,
    locale: loginLanguage(locale),
    country: loginCountry(),
  });
  navigate(url);
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
  const problem = loginAnswerProblem(answer.idToken, { nonce: pending.nonce, issuer, client });
  if (problem !== null) throw new TetherError(`Customer accounts: the login answer did not check out (${problem})`);
  await startSession(answer);
  emit('account-login', {});
  const back = pending.returnTo ? new URL(pending.returnTo, window.location.href) : null;
  if (back?.origin === window.location.origin && back.href !== clean.href) navigate(back.href);
  return true;
}
