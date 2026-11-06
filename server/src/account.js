/**
 * Customer accounts through the Worker (server mode): the visitor's browser never holds a Shopify token. The Worker
 * logs the customer in with Shopify's Customer Account API (OAuth with PKCE, the id token's signature checked), keeps
 * the tokens sealed in KV, and gives the browser only an HttpOnly session cookie. The browser can then ask for a fixed
 * set of things, listed in `NAVIGATIONS` and `customerRoute` below and in `server/src/shared/account-ops.js`.
 *
 * The Worker must run on the shop's own domain (a route `shop.com/_tether/*`), so the browser sends the cookie.
 * Settings and set-up: `docs/accounts.md`.
 */

/** @import { AccountSettings } from './account/settings.js' */
/** @import { Fetch } from './account/shopify.js' */
/** @import { Session } from './account/session.js' */

import { CUSTOMER_QUERY, ORDERS_QUERY } from './shared/account-documents.js';
import { InputError, ops, ROUTES as OPERATION_ROUTES } from './shared/account-ops.js';
import { randomToken, toBase64Url } from './shared/base64url.js';
import { open, seal, sha256 } from './crypto.js';
import { accountProblems, accountSettings } from './account/settings.js';
import { accountStore } from './account/kv.js';
import { createSessionStore, sessionTokens } from './account/session.js';
import {
  customerQuery,
  discover,
  linkCart,
  tokenRequest,
  UnauthorizedError,
  verifyIdToken,
} from './account/shopify.js';
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
  if (value === null || typeof value !== 'object') return false;
  const login = /** @type {Record<string, unknown>} */ (value);
  const texts = ['state', 'nonce', 'verifier', 'returnTo'].every((key) => typeof login[key] === 'string');
  return texts && typeof login['at'] === 'number';
}

/** @param {unknown} value @returns {value is LogoutTicket} */
function isLogoutTicket(value) {
  if (value === null || typeof value !== 'object') return false;
  const ticket = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof ticket['idToken'] === 'string' && typeof ticket['returnTo'] === 'string' && typeof ticket['at'] === 'number'
  );
}

/**
 * The request body as a JSON object; `{}` for anything else.
 *
 * @param {Request} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonObject(request) {
  /** @type {unknown} */
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return /** @type {Record<string, unknown>} */ (body);
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A rejection handler that logs the failure under `label` and lets the request carry on.
 *
 * @param {string} label
 */
function logFailure(label) {
  return (/** @type {unknown} */ error) => {
    console.error(label, errorMessage(error));
  };
}

/** @param {unknown} value @param {string} key */
function field(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  return /** @type {Record<string, unknown>} */ (value)[key];
}

/** @param {unknown} value */
function textOrNull(value) {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Everything a route needs about the request it answers.
 *
 * @typedef {object} AccountRequest
 * @property {Request} request
 * @property {URL} url
 * @property {AccountSettings} settings
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
  const authorize = new URL(discovery.authorization_endpoint);
  const locale = (url.searchParams.get('locale') ?? '').replace(/[^a-zA-Z-]/g, '').slice(0, 8);
  const country = (url.searchParams.get('country') ?? '')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 2)
    .toUpperCase();
  /** @type {Record<string, string>} */
  const params = {
    client_id: settings.clientId,
    scope: 'openid email customer-account-api:full',
    response_type: 'code',
    redirect_uri: callbackUrl,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: toBase64Url(await sha256(pending.verifier)),
    code_challenge_method: 'S256',
  };
  if (locale) params['locale'] = locale;
  if (country) params['region_country'] = country;
  for (const [name, value] of Object.entries(params)) authorize.searchParams.set(name, value);
  // Nothing is stored before the customer comes back: the pending login is sealed into a cookie in this browser,
  // which also stops another browser from completing it (login CSRF).
  const sealed = await seal(settings.secret, 'login', LOGIN_COOKIE, pending);
  return redirectResponse(authorize.toString(), {
    'Set-Cookie': setCookie(LOGIN_COOKIE, sealed, PENDING_LOGIN_SECONDS),
  });
}

/** @param {AccountRequest} context */
async function callback({ request, url, settings, sessions, fetch: fetchImpl, siteOrigin, callbackUrl }) {
  const clearLogin = setCookie(LOGIN_COOKIE, '', 0);
  const pending = await open(settings.secret, 'login', LOGIN_COOKIE, readCookie(request, LOGIN_COOKIE, 2000));
  const state = url.searchParams.get('state') ?? '';
  const expired = isPendingLogin(pending) && Date.now() - pending.at > PENDING_LOGIN_SECONDS * 1000;
  if (!isPendingLogin(pending) || !state || pending.state !== state || expired) {
    return redirectResponse(`${siteOrigin}/?account=expired`, { 'Set-Cookie': clearLogin });
  }
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) {
    return redirectResponse(safeReturn(pending.returnTo, settings), { 'Set-Cookie': clearLogin });
  }
  const discovery = await discover(settings, fetchImpl);
  const grant = { grant_type: 'authorization_code', redirect_uri: callbackUrl, code, code_verifier: pending.verifier };
  const tokens = await tokenRequest(settings, discovery, grant, siteOrigin, fetchImpl);
  await verifyIdToken(tokens.id_token, discovery, settings, pending.nonce, fetchImpl);
  const id = randomToken(32);
  /** @type {Session} */
  const session = {
    ...sessionTokens(tokens, { refresh: null, idToken: tokens.id_token ?? '' }),
    createdAt: Date.now(),
  };
  await sessions.save(id, session);
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
 * Logout, step 1: ends the session here first, whatever Shopify does, and unlinks the cart.
 *
 * @param {AccountRequest} context
 * @param {Record<string, string>} cors
 */
async function logout({ request, url, settings, sessions, sessionId, fetch: fetchImpl, siteOrigin }, cors) {
  const body = await readJsonObject(request);
  const session = sessionId ? await sessions.load(sessionId).catch(() => null) : null;
  if (sessionId) await sessions.end(sessionId).catch(logFailure('account logout'));
  const headers = new Headers({ 'Content-Type': 'application/json', ...NO_STORE, ...cors });
  headers.append('Set-Cookie', setCookie(SESSION_COOKIE, '', 0));
  const returnTo = safeReturn(typeof body['returnTo'] === 'string' ? body['returnTo'] : `${siteOrigin}/`, settings);
  const cartId = typeof body['cartId'] === 'string' ? body['cartId'] : '';
  // The next person on this device must not check out as this customer, so a failed unlink is logged.
  if (CART_ID.test(cartId)) {
    await linkCart(settings, cartId, null, fetchImpl).catch((error) =>
      console.error('account cart unlink', errorMessage(error)),
    );
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
 * The routes that need a session, behind CORS and (for POST) the CSRF header.
 *
 * @param {AccountRequest} context
 * @param {Record<string, string>} cors
 * @param {string} route
 */
async function customerRoute(context, cors, route) {
  const { request, url, settings, sessions, sessionId, fetch: fetchImpl, siteOrigin } = context;
  const loaded = sessionId ? await sessions.load(sessionId) : null;
  const session = loaded && sessionId ? await sessions.fresh(sessionId, loaded, siteOrigin) : null;
  const api = session ? customerApi(context, session) : null;
  const method = request.method;

  if (route === '/me' && method === 'GET') {
    const data = api ? await api.ask(CUSTOMER_QUERY, {}) : null;
    if (!data) return jsonResponse({ loggedIn: false }, 200, cors);
    return jsonResponse({ loggedIn: true, customer: customerProfile(data) }, 200, cors);
  }
  if (route === '/orders' && method === 'GET') {
    const first = Math.max(1, Math.min(50, parseInt(url.searchParams.get('first') ?? '10', 10) || 10));
    const data = api ? await api.ask(ORDERS_QUERY, { first }) : null;
    if (!data) return jsonResponse({ loggedIn: false, orders: [] }, 401, cors);
    const orders = field(field(field(data, 'customer'), 'orders'), 'nodes') ?? [];
    return jsonResponse({ loggedIn: true, orders }, 200, cors);
  }
  if (route === '/cart' && method === 'POST') {
    if (!session) return jsonResponse({ loggedIn: false }, 401, cors);
    const cartId = field(await readJsonObject(request), 'cartId');
    if (typeof cartId !== 'string' || !CART_ID.test(cartId)) return jsonResponse({ error: 'cartId' }, 400, cors);
    const checkoutUrl = await linkCart(settings, cartId, session.access, fetchImpl);
    return jsonResponse({ linked: Boolean(checkoutUrl), checkoutUrl }, 200, cors);
  }
  const operation = OPERATION_ROUTES[`${method} ${route}`];
  if (!operation) return jsonResponse({ error: 'not found' }, 404, cors);
  if (!api) return jsonResponse({ loggedIn: false }, 401, cors);
  const body = method === 'POST' ? await readJsonObject(request) : {};
  const { name, input } = operation(url, body);
  const run = ops[name];
  if (!run) return jsonResponse({ error: 'not found' }, 404, cors);
  try {
    const out = await run((query, variables) => api.ask(query, variables), input);
    if (api.ended) return jsonResponse({ loggedIn: false }, 401, cors);
    return jsonResponse({ ok: true, ...out }, 200, cors);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    const userErrors = error.userErrors.length ? error.userErrors : undefined;
    return jsonResponse({ error: error.message, userErrors }, error.status, cors);
  }
}

/** Top-level navigations: no CORS; the cookies prove which browser it is. */
const NAVIGATIONS = new Map([
  ['GET /login', login],
  ['GET /callback', callback],
  ['GET /logout/go', logoutRedirect],
]);

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
  const settings = accountSettings(env);
  if (!settings) return jsonResponse({ error: 'accounts are not set up' }, 404);
  const problems = accountProblems(settings).filter((problem) => problem.severity === 'error');
  if (problems.length) {
    console.error('account setup', problems.map((problem) => problem.message).join('; '));
    return jsonResponse({ error: 'accounts are not set up (see /check)' }, 503);
  }
  const namespace = /** @type {import('./account/kv.js').KvNamespace | undefined} */ (env['TETHER_SYNC']);
  /** @type {AccountRequest} */
  const context = {
    request,
    url,
    settings,
    sessions: createSessionStore({ store: accountStore(namespace, memory), settings, fetch: fetchImpl }),
    sessionId: readCookie(request, SESSION_COOKIE, 100),
    fetch: fetchImpl,
    siteOrigin: settings.origins[0] ?? '',
    callbackUrl: `${url.origin}${BASE}/callback`,
  };
  const route = url.pathname.slice(BASE.length);
  const cors = corsHeaders(request, settings);

  if (request.method === 'OPTIONS') {
    return cors
      ? new Response(null, { status: 204, headers: { ...cors, ...NO_STORE } })
      : new Response(null, { status: 403 });
  }
  try {
    const navigation = NAVIGATIONS.get(`${request.method} ${route}`);
    if (navigation) return await navigation(context);
    // Everything else is fetch() from the site: allowed origins only, and POSTs carry a custom header, which forces a
    // CORS preflight (CSRF).
    if (!cors) return jsonResponse({ error: 'origin not allowed' }, 403);
    if (request.method === 'POST' && request.headers.get('x-tether-account') !== '1') {
      return jsonResponse({ error: 'missing header' }, 400, cors);
    }
    if (route === '/logout' && request.method === 'POST') return await logout(context, cors);
    return await customerRoute(context, cors, route);
  } catch (error) {
    console.error('account', errorMessage(error));
    return jsonResponse({ error: 'account error' }, 502, cors ?? {});
  }
}
