/**
 * Customer accounts through the Worker (server mode): the visitor's browser never holds a Shopify token. The Worker
 * logs the customer in with Shopify's Customer Account API (OAuth with PKCE, the id token's signature checked), keeps
 * the tokens sealed in KV, and gives the browser only an HttpOnly session cookie. The browser can then ask for a fixed
 * set of things, listed in `NAVIGATIONS` and `customerRoute` below and in `server/src/shared/account-ops.js`.
 *
 * The Worker must run on the shop's own domain (a route `shop.com/_tether/*`), so the browser sends the cookie.
 * Settings and set-up: `docs/accounts.md`.
 */

/** @import { ReadyAccountSettings } from './account/settings.js' */
/** @import { Fetch } from './account/shopify.js' */
/** @import { Session } from './account/session.js' */
/** @import { OperationCall } from './shared/account-ops.js' */

import { CUSTOMER_QUERY, ORDERS_QUERY } from './shared/account-documents.js';
import { authorizeUrl } from './shared/account-login.js';
import { InputError, operationCall, ops } from './shared/account-ops.js';
import { randomToken } from './shared/base64url.js';
import { field, isRecord } from './shared/json.js';
import { open, seal } from './crypto.js';
import { asRecord, responseJsonOrNull, textOrNull } from './json.js';
import { messageOf } from './util.js';
import { accountProblems, accountSettings, readyAccountSettings } from './account/settings.js';
import { accountStore } from './account/kv.js';
import { createSessionStore, sessionTokens } from './account/session.js';
import { verifyIdToken } from './account/id-token.js';
import { customerQuery, discover, linkCart, tokenRequest, UnauthorizedError } from './account/shopify.js';
import {
  corsHeaders,
  jsonResponse,
  LOGIN_COOKIE,
  LOGOUT_COOKIE,
  NO_STORE,
  readCookie,
  redirectResponse,
  safeReturn,
  SESSION_COOKIE,
  setCookie,
} from './account/http.js';

export { accountProblems, accountSettings };

/** Every account route lives under this path. */
export const BASE = '/_tether/account';

/** Seconds a login may take between leaving for Shopify and coming back. */
const PENDING_LOGIN_SECONDS = 600;
/** Seconds the one-time logout ticket stays valid. */
const LOGOUT_TICKET_SECONDS = 120;
const CART_ID = /^gid:\/\/shopify\/Cart\/[\w-]+(\?key=[\w-]+)?$/;

/** @typedef {{ state: string, nonce: string, verifier: string, at: number, returnTo: string }} PendingLogin */
/** @typedef {{ idToken: string, returnTo: string, at: number }} LogoutTicket */

/** @param {unknown} value @returns {value is PendingLogin} */
function isPendingLogin(value) {
  if (!isRecord(value)) return false;
  const texts = ['state', 'nonce', 'verifier', 'returnTo'].every((key) => typeof value[key] === 'string');
  return texts && typeof value['at'] === 'number';
}

/** @param {unknown} value @returns {value is LogoutTicket} */
function isLogoutTicket(value) {
  if (!isRecord(value)) return false;
  return (
    typeof value['idToken'] === 'string' && typeof value['returnTo'] === 'string' && typeof value['at'] === 'number'
  );
}

/**
 * The request body as a JSON object; `{}` for a body that is not one, whose fields the routes then refuse one by one.
 *
 * @param {Request} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonObject(request) {
  return asRecord(await responseJsonOrNull(request));
}

/**
 * A rejection handler that logs the failure under `label` and lets the request carry on.
 *
 * @param {string} label
 */
function logFailure(label) {
  return (/** @type {unknown} */ error) => {
    console.error(label, messageOf(error));
  };
}

/**
 * Everything a route needs about the request it answers.
 *
 * @typedef {object} AccountRequest
 * @property {Request} request
 * @property {URL} url
 * @property {ReadyAccountSettings} settings
 * @property {ReturnType<typeof createSessionStore>} sessions
 * @property {string | null} sessionId The session cookie's value.
 * @property {Fetch} fetch
 * @property {string} siteOrigin The site's home origin.
 * @property {string} callbackUrl
 */

/** @param {AccountRequest} context */
async function login({ request, url, settings, fetch: fetchImpl, callbackUrl }) {
  const discovery = await discover(settings, fetchImpl);
  /** @type {PendingLogin} */
  const pending = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    at: Date.now(),
    returnTo: safeReturn(url.searchParams.get('returnTo') ?? request.headers.get('referer') ?? '', settings),
  };
  const locale = (url.searchParams.get('locale') ?? '').replace(/[^a-zA-Z-]/g, '').slice(0, 8);
  const country = (url.searchParams.get('country') ?? '')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 2)
    .toUpperCase();
  const authorize = await authorizeUrl(discovery.authorization_endpoint, {
    clientId: settings.clientId,
    redirectUri: callbackUrl,
    state: pending.state,
    nonce: pending.nonce,
    verifier: pending.verifier,
    locale,
    country,
  });
  // Nothing is stored before the customer comes back: the pending login is sealed into a cookie in this browser,
  // which also stops another browser from completing it (login CSRF).
  const sealed = await seal(settings.secret, 'login', LOGIN_COOKIE, pending);
  return redirectResponse(authorize, {
    'Set-Cookie': setCookie(LOGIN_COOKIE, sealed, PENDING_LOGIN_SECONDS),
  });
}

/**
 * The pending login of this browser, when it is the one Shopify's answer belongs to and not older than
 * {@link PENDING_LOGIN_SECONDS}.
 *
 * @param {AccountRequest} context
 * @returns {Promise<PendingLogin | null>}
 */
async function pendingLoginOf({ request, url, settings }) {
  const pending = await open(settings.secret, 'login', LOGIN_COOKIE, readCookie(request, LOGIN_COOKIE, 2000));
  const state = url.searchParams.get('state') ?? '';
  if (!isPendingLogin(pending) || !state || pending.state !== state) return null;
  return Date.now() - pending.at > PENDING_LOGIN_SECONDS * 1000 ? null : pending;
}

/** @param {AccountRequest} context */
async function callback(context) {
  const { url, settings, sessions, sessionId, fetch: fetchImpl, siteOrigin, callbackUrl } = context;
  const clearLogin = setCookie(LOGIN_COOKIE, '', 0);
  const pending = await pendingLoginOf(context);
  if (!pending) return redirectResponse(`${siteOrigin}/?account=expired`, { 'Set-Cookie': clearLogin });
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) {
    return redirectResponse(safeReturn(pending.returnTo, settings), { 'Set-Cookie': clearLogin });
  }
  const discovery = await discover(settings, fetchImpl);
  const grant = { grant_type: 'authorization_code', redirect_uri: callbackUrl, code, code_verifier: pending.verifier };
  const tokens = await tokenRequest(settings, discovery, grant, siteOrigin, fetchImpl);
  const idToken = tokens.id_token;
  if (!idToken) throw new Error('id token missing');
  await verifyIdToken(idToken, discovery, settings, pending.nonce, fetchImpl);
  const id = randomToken(32);
  /** @type {Session} */
  const session = { ...sessionTokens(tokens, { refresh: null, idToken }), createdAt: Date.now() };
  await sessions.save(id, session);
  // The cookie is about to point at the new session, so the old one could never be ended from this browser again.
  if (sessionId) await sessions.end(sessionId).catch(logFailure('account login: previous session not ended'));
  const back = new URL(safeReturn(pending.returnTo, settings));
  back.searchParams.set('account', 'in');
  const headers = new Headers({ Location: back.href, ...NO_STORE });
  headers.append('Set-Cookie', setCookie(SESSION_COOKIE, id, settings.sessionDays * 86400));
  headers.append('Set-Cookie', clearLogin);
  return new Response(null, { status: 302, headers });
}

/**
 * Logout, step 2: a top-level navigation on to Shopify's logout. The id token comes from the one-time HttpOnly
 * cookie that step 1 set.
 *
 * @param {AccountRequest} context
 */
async function logoutRedirect({ request, settings, fetch: fetchImpl, siteOrigin }) {
  const ticket = await open(settings.secret, 'logout', LOGOUT_COOKIE, readCookie(request, LOGOUT_COOKIE, 6000));
  const clear = { 'Set-Cookie': setCookie(LOGOUT_COOKIE, '', 0) };
  if (!isLogoutTicket(ticket) || Date.now() - ticket.at > LOGOUT_TICKET_SECONDS * 1000) {
    return redirectResponse(`${siteOrigin}/`, clear);
  }
  try {
    const shopifyLogout = new URL((await discover(settings, fetchImpl)).end_session_endpoint);
    shopifyLogout.searchParams.set('id_token_hint', ticket.idToken);
    shopifyLogout.searchParams.set('post_logout_redirect_uri', ticket.returnTo);
    return redirectResponse(shopifyLogout.toString(), clear);
  } catch {
    // Shopify's endpoints can't be reached: the session here is already gone, so go back to the site.
    return redirectResponse(ticket.returnTo, clear);
  }
}

/**
 * The session being logged out, for its id token. A KV failure is logged and the logout carries on without one: the
 * session is still ended here, only Shopify's own logout is skipped.
 *
 * @param {AccountRequest['sessions']} sessions
 * @param {string} sessionId
 * @returns {Promise<Session | null>}
 */
async function sessionForLogout(sessions, sessionId) {
  try {
    return await sessions.load(sessionId);
  } catch (error) {
    console.error('account logout: session not read, so Shopify is not logged out', messageOf(error));
    return null;
  }
}

/**
 * Logout, step 1: ends the session here first, whatever Shopify does, and unlinks the cart.
 *
 * @param {AccountRequest} context
 * @param {Record<string, string>} cors
 */
async function logout({ request, url, settings, sessions, sessionId, fetch: fetchImpl, siteOrigin }, cors) {
  const body = await readJsonObject(request);
  const session = sessionId ? await sessionForLogout(sessions, sessionId) : null;
  if (sessionId) await sessions.end(sessionId).catch(logFailure('account logout'));
  const headers = new Headers({ 'Content-Type': 'application/json', ...NO_STORE, ...cors });
  headers.append('Set-Cookie', setCookie(SESSION_COOKIE, '', 0));
  const returnTo = safeReturn(typeof body['returnTo'] === 'string' ? body['returnTo'] : `${siteOrigin}/`, settings);
  const cartId = typeof body['cartId'] === 'string' ? body['cartId'] : '';
  // The next person on this device must not check out as this customer, so a failed unlink is logged.
  if (CART_ID.test(cartId)) {
    await linkCart(settings, cartId, null, fetchImpl).catch(logFailure('account cart unlink'));
  }
  let logoutUrl = null;
  if (session?.idToken) {
    /** @type {LogoutTicket} */
    const ticket = { idToken: session.idToken, returnTo, at: Date.now() };
    const sealed = await seal(settings.secret, 'logout', LOGOUT_COOKIE, ticket);
    headers.append('Set-Cookie', setCookie(LOGOUT_COOKIE, sealed, LOGOUT_TICKET_SECONDS));
    logoutUrl = `${url.origin}${BASE}/logout/go`;
  }
  return new Response(JSON.stringify({ loggedOut: true, logoutUrl }), { status: 200, headers });
}

/**
 * The logged-in customer's Customer Account API for one request. `ended` turns true when Shopify refuses the token;
 * the session is then ended here too.
 *
 * @param {AccountRequest} context
 * @param {Session} session
 */
function customerApi({ settings, sessions, sessionId, fetch: fetchImpl, siteOrigin }, session) {
  const api = {
    ended: false,
    /**
     * @param {string} query
     * @param {Record<string, unknown>} variables
     * @returns {Promise<Record<string, unknown> | null>} `null` once Shopify has ended the session.
     */
    async ask(query, variables) {
      try {
        const discovery = await discover(settings, fetchImpl);
        return await customerQuery(discovery, session.access, query, variables, siteOrigin, fetchImpl);
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw error;
        api.ended = true;
        if (sessionId) await sessions.end(sessionId);
        return null;
      }
    },
  };
  return api;
}

/** @param {unknown} data */
function customerProfile(data) {
  const customer = field(data, 'customer');
  return {
    firstName: textOrNull(field(customer, 'firstName')),
    lastName: textOrNull(field(customer, 'lastName')),
    displayName: textOrNull(field(customer, 'displayName')),
    email: textOrNull(field(field(customer, 'emailAddress'), 'emailAddress')),
    address: field(field(customer, 'defaultAddress'), 'formatted') ?? null,
  };
}

/**
 * The logged-in customer of a request, with an access token that is good for a while; `null` when logged out.
 *
 * @typedef {{ session: Session, api: ReturnType<typeof customerApi> } | null} Customer
 */

/**
 * @param {AccountRequest} context
 * @returns {Promise<Customer>}
 */
async function customerOf(context) {
  const { sessions, sessionId, siteOrigin } = context;
  if (!sessionId) return null;
  const loaded = await sessions.load(sessionId);
  const session = loaded ? await sessions.fresh(sessionId, loaded, siteOrigin) : null;
  return session ? { session, api: customerApi(context, session) } : null;
}

/**
 * @typedef {(context: AccountRequest, cors: Record<string, string>, customer: Customer) => Promise<Response>} CustomerRoute
 */

/** @type {CustomerRoute} */
async function me(_context, cors, customer) {
  const data = customer ? await customer.api.ask(CUSTOMER_QUERY, {}) : null;
  if (!data) return jsonResponse({ loggedIn: false }, 200, cors);
  return jsonResponse({ loggedIn: true, customer: customerProfile(data) }, 200, cors);
}

/** Orders per page when the request doesn't say, and at most. */
const DEFAULT_ORDERS = 10;
const MAX_ORDERS = 50;

/** @type {CustomerRoute} */
async function orders({ url }, cors, customer) {
  const asked = parseInt(url.searchParams.get('first') ?? '', 10) || DEFAULT_ORDERS;
  const first = Math.max(1, Math.min(MAX_ORDERS, asked));
  const data = customer ? await customer.api.ask(ORDERS_QUERY, { first }) : null;
  if (!data) return jsonResponse({ loggedIn: false, orders: [] }, 401, cors);
  const list = field(field(field(data, 'customer'), 'orders'), 'nodes') ?? [];
  return jsonResponse({ loggedIn: true, orders: list }, 200, cors);
}

/** @type {CustomerRoute} */
async function cart({ request, settings, fetch: fetchImpl }, cors, customer) {
  if (!customer) return jsonResponse({ loggedIn: false }, 401, cors);
  const cartId = field(await readJsonObject(request), 'cartId');
  if (typeof cartId !== 'string' || !CART_ID.test(cartId)) return jsonResponse({ error: 'cartId' }, 400, cors);
  const checkoutUrl = await linkCart(settings, cartId, customer.session.access, fetchImpl);
  return jsonResponse({ linked: Boolean(checkoutUrl), checkoutUrl }, 200, cors);
}

/**
 * One of the fixed account operations (order detail, profile, addresses, subscriptions, returns).
 *
 * @param {Record<string, string>} cors
 * @param {Customer} customer
 * @param {OperationCall} call
 */
async function operation(cors, customer, { name, input }) {
  if (!customer) return jsonResponse({ loggedIn: false }, 401, cors);
  const { api } = customer;
  try {
    const out = await ops[name]((query, variables) => api.ask(query, variables), input);
    if (api.ended) return jsonResponse({ loggedIn: false }, 401, cors);
    return jsonResponse({ ok: true, ...out }, 200, cors);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    const userErrors = error.userErrors.length ? error.userErrors : undefined;
    return jsonResponse({ error: error.message, userErrors }, error.status, cors);
  }
}

/** The routes for the logged-in customer, besides the operations in account-ops.js. */
const CUSTOMER_ROUTES = new Map([
  ['GET /me', me],
  ['GET /orders', orders],
  ['POST /cart', cart],
]);

/**
 * The routes that need a session, behind CORS and (for POST) the CSRF header.
 *
 * @param {AccountRequest} context
 * @param {Record<string, string>} cors
 * @param {string} route
 */
async function customerRoute(context, cors, route) {
  const { method } = context.request;
  const handler = CUSTOMER_ROUTES.get(`${method} ${route}`);
  if (handler) return handler(context, cors, await customerOf(context));
  const body = method === 'POST' ? await readJsonObject(context.request) : {};
  const call = operationCall(method, route, context.url, body);
  if (!call) return jsonResponse({ error: 'not found' }, 404, cors);
  return operation(cors, await customerOf(context), call);
}

/** Top-level navigations: no CORS; the cookies prove which browser it is. */
const NAVIGATIONS = new Map([
  ['GET /login', login],
  ['GET /callback', callback],
  ['GET /logout/go', logoutRedirect],
]);

/**
 * Where a top-level navigation that failed lands: the site, with `?account=error` for the page to report, and without
 * the login and logout cookies, so a stale pending login or ticket can't be retried.
 *
 * @param {string} siteOrigin
 */
function navigationFailed(siteOrigin) {
  const headers = new Headers({ Location: `${siteOrigin}/?account=error`, ...NO_STORE });
  headers.append('Set-Cookie', setCookie(LOGIN_COOKIE, '', 0));
  headers.append('Set-Cookie', setCookie(LOGOUT_COOKIE, '', 0));
  return new Response(null, { status: 302, headers });
}

/**
 * Handles `/_tether/account/*`.
 *
 * @param {Request} request
 * @param {Record<string, unknown>} env The Worker's env.
 * @param {{ fetch?: Fetch, memory?: import('./account/kv.js').MemoryEntries }} [options] `memory` is the store used
 *   without a KV namespace (tests).
 * @returns {Promise<Response | null>} `null` when the path isn't an account route.
 */
export async function handleAccount(request, env, { fetch: fetchImpl = globalThis.fetch, memory } = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${BASE}/`)) return null;
  const configured = accountSettings(env);
  if (!configured) return jsonResponse({ error: 'accounts are not set up' }, 404);
  const ready = readyAccountSettings(configured);
  if (ready.kind === 'not-ready') {
    console.error('account setup', ready.errors.map((problem) => problem.message).join('; '));
    return jsonResponse({ error: 'accounts are not set up (see /check)' }, 503);
  }
  const { settings } = ready;
  const namespace = /** @type {import('./account/kv.js').KvNamespace | undefined} */ (env['TETHER_SYNC']);
  /** @type {AccountRequest} */
  const context = {
    request,
    url,
    settings,
    sessions: createSessionStore({ store: accountStore(namespace, memory), settings, fetch: fetchImpl }),
    sessionId: readCookie(request, SESSION_COOKIE, 100),
    fetch: fetchImpl,
    siteOrigin: settings.origins[0],
    callbackUrl: `${url.origin}${BASE}/callback`,
  };
  const route = url.pathname.slice(BASE.length);
  const cors = corsHeaders(request, settings);

  if (request.method === 'OPTIONS') {
    return cors
      ? new Response(null, { status: 204, headers: { ...cors, ...NO_STORE } })
      : new Response(null, { status: 403 });
  }
  const navigation = NAVIGATIONS.get(`${request.method} ${route}`);
  if (navigation) {
    try {
      return await navigation(context);
    } catch (error) {
      console.error('account', messageOf(error));
      return navigationFailed(context.siteOrigin);
    }
  }
  try {
    // Everything else is fetch() from the site: allowed origins only, and POSTs carry a custom header, which forces a
    // CORS preflight (CSRF).
    if (!cors) return jsonResponse({ error: 'origin not allowed' }, 403);
    if (request.method === 'POST' && request.headers.get('x-tether-account') !== '1') {
      return jsonResponse({ error: 'missing header' }, 400, cors);
    }
    if (route === '/logout' && request.method === 'POST') return await logout(context, cors);
    return await customerRoute(context, cors, route);
  } catch (error) {
    console.error('account', messageOf(error));
    return jsonResponse({ error: 'account error' }, 502, cors ?? {});
  }
}
