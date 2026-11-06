/**
 * Customer accounts through the Worker: the visitor's browser never holds a Shopify token. The Worker
 * logs the customer in with Shopify's Customer Account API (OAuth with PKCE, the id token's signature checked), keeps
 * the tokens sealed in KV, and gives the browser only an HttpOnly session cookie. The browser can then ask for a fixed
 * set of things: the navigations in `NAVIGATIONS` below, logout, and the routes in `account/customer.ts`.
 *
 * The Worker must run on the shop's own domain (a route `shop.com/_tether/*`), so the browser sends the cookie.
 * Settings and set-up: `docs/accounts.md`.
 */

import type { ReadyAccountSettings } from './account/settings.ts';
import type { Fetch } from './account/shopify.ts';
import type { Session } from './account/session.ts';
import type { ExpiringStore, MemoryEntries } from './account/kv.ts';
import { authorizeUrl } from './account/authorize.ts';
import { randomToken } from './base64url.ts';
import { isRecord } from './shared/json.ts';
import { open, seal } from './crypto.ts';
import { messageOf } from './util.ts';
import { kvBinding } from './env.ts';
import { accountProblems, accountSettings, readyAccountSettings } from './account/settings.ts';
import { kvAccountStore, memoryAccountStore } from './account/kv.ts';
import { createSessionStore, sessionTokens } from './account/session.ts';
import { verifyIdToken } from './account/id-token.ts';
import { discover, linkCart, tokenRequest } from './account/shopify.ts';
import { customerRoute } from './account/customer.ts';
import {
  BodyTooLarge,
  CART_ID,
  corsHeaders,
  jsonResponse,
  LOGIN_COOKIE,
  LOGOUT_COOKIE,
  NO_STORE,
  readCookie,
  readJsonObject,
  redirectResponse,
  safeReturn,
  SESSION_COOKIE,
  setCookie,
} from './account/http.ts';

export { accountProblems, accountSettings };

/** Every account route lives under this path. */
export const BASE = '/_tether/account';

/** Seconds a login may take between leaving for Shopify and coming back. */
const PENDING_LOGIN_SECONDS = 600;
/** Seconds the one-time logout ticket stays valid. */
const LOGOUT_TICKET_SECONDS = 120;

interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
  at: number;
  returnTo: string;
}
interface LogoutTicket {
  idToken: string;
  returnTo: string;
  at: number;
}

function isPendingLogin(value: unknown): value is PendingLogin {
  if (!isRecord(value)) return false;
  const texts = ['state', 'nonce', 'verifier', 'returnTo'].every((key) => typeof value[key] === 'string');
  return texts && typeof value['at'] === 'number';
}

function isLogoutTicket(value: unknown): value is LogoutTicket {
  if (!isRecord(value)) return false;
  return (
    typeof value['idToken'] === 'string' && typeof value['returnTo'] === 'string' && typeof value['at'] === 'number'
  );
}

/** A rejection handler that logs the failure under `label` and lets the request carry on. */
function logFailure(label: string): (error: unknown) => void {
  return (error) => {
    console.error(label, messageOf(error));
  };
}

/** Everything a route needs about the request it answers. */
export interface AccountRequest {
  request: Request;
  url: URL;
  settings: ReadyAccountSettings;
  sessions: ReturnType<typeof createSessionStore>;
  /** The session cookie's value. */
  sessionId: string | null;
  fetch: Fetch;
  /** The site's home origin. */
  siteOrigin: string;
  callbackUrl: string;
}

async function login({ request, url, settings, fetch: fetchImpl, callbackUrl }: AccountRequest): Promise<Response> {
  const discovery = await discover(settings, fetchImpl);
  const pending: PendingLogin = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    at: Date.now(),
    // The Referer is whatever the browser sent: like `returnTo`, it only counts when it is on one of the site's origins.
    returnTo: safeReturn(url.searchParams.get('returnTo') ?? request.headers.get('referer') ?? '', settings),
  };
  const locale = (url.searchParams.get('locale') ?? '').replace(/[^a-zA-Z-]/g, '').slice(0, 8);
  const country = (url.searchParams.get('country') ?? '')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 2)
    .toUpperCase();
  const authorize = await authorizeUrl(discovery.authorizationEndpoint, {
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
 * What the login cookie says about Shopify's answer. `expired`: no pending login in this browser (its cookie lasts
 * as long as a login may take), or one older than {@link PENDING_LOGIN_SECONDS}. `mismatch`: a pending login that
 * isn't the one the answer belongs to (another tab's, or a forged answer: login CSRF), or a cookie that doesn't open.
 */
type PendingLoginCheck =
  { kind: 'pending'; pending: PendingLogin } | { kind: 'expired'; returnTo: string | null } | { kind: 'mismatch' };

async function pendingLoginOf({ request, url, settings }: AccountRequest): Promise<PendingLoginCheck> {
  const cookie = readCookie(request, LOGIN_COOKIE, 2000);
  if (cookie === null) return { kind: 'expired', returnTo: null };
  const pending = await open(settings.secret, 'login', LOGIN_COOKIE, cookie);
  const state = url.searchParams.get('state') ?? '';
  if (!isPendingLogin(pending) || !state || pending.state !== state) return { kind: 'mismatch' };
  if (Date.now() - pending.at > PENDING_LOGIN_SECONDS * 1000) return { kind: 'expired', returnTo: pending.returnTo };
  return { kind: 'pending', pending };
}

/** Where a login lands: `returnTo` (the site's home when it is unknown) with `?account=<outcome>` for the page. */
function landing(
  returnTo: string | null,
  outcome: 'in' | 'expired' | 'error',
  { settings, siteOrigin }: AccountRequest,
): string {
  const back = new URL(returnTo === null ? `${siteOrigin}/` : safeReturn(returnTo, settings));
  back.searchParams.set('account', outcome);
  return back.href;
}

async function callback(context: AccountRequest): Promise<Response> {
  const { url, settings, sessions, sessionId, fetch: fetchImpl, siteOrigin, callbackUrl } = context;
  const clearLogin = { 'Set-Cookie': setCookie(LOGIN_COOKIE, '', 0) };
  const check = await pendingLoginOf(context);
  if (check.kind === 'expired') return redirectResponse(landing(check.returnTo, 'expired', context), clearLogin);
  if (check.kind === 'mismatch') {
    console.error('account login: the answer is not for the pending login in this browser');
    return redirectResponse(landing(null, 'error', context), clearLogin);
  }
  const { pending } = check;
  const code = url.searchParams.get('code');
  // Shopify sends `error` when the customer cancels or the login fails on its side.
  const refused = url.searchParams.get('error');
  if (refused !== null || !code) {
    console.error('account login: Shopify answered', (refused ?? 'without a code').slice(0, 100));
    return redirectResponse(landing(pending.returnTo, 'error', context), clearLogin);
  }
  const discovery = await discover(settings, fetchImpl);
  const grant = { grant_type: 'authorization_code', redirect_uri: callbackUrl, code, code_verifier: pending.verifier };
  const tokens = await tokenRequest(settings, discovery, grant, siteOrigin, fetchImpl);
  const { idToken } = tokens;
  if (!idToken) throw new Error('id token missing');
  await verifyIdToken(idToken, discovery, settings, pending.nonce, fetchImpl);
  const id = randomToken(32);
  const session: Session = { ...sessionTokens(tokens, { refresh: null, idToken }), createdAt: Date.now() };
  await sessions.save(id, session);
  // The cookie is about to point at the new session, so the old one could never be ended from this browser again.
  if (sessionId) await sessions.end(sessionId).catch(logFailure('account login: previous session not ended'));
  const headers = new Headers({ Location: landing(pending.returnTo, 'in', context), ...NO_STORE });
  headers.append('Set-Cookie', setCookie(SESSION_COOKIE, id, settings.sessionDays * 86400));
  headers.append('Set-Cookie', clearLogin['Set-Cookie']);
  return new Response(null, { status: 302, headers });
}

/**
 * Logout, step 2: a top-level navigation on to Shopify's logout. The id token comes from the one-time HttpOnly
 * cookie that step 1 set.
 */
async function logoutRedirect({ request, settings, fetch: fetchImpl, siteOrigin }: AccountRequest): Promise<Response> {
  const ticket = await open(settings.secret, 'logout', LOGOUT_COOKIE, readCookie(request, LOGOUT_COOKIE, 6000));
  const clear = { 'Set-Cookie': setCookie(LOGOUT_COOKIE, '', 0) };
  if (!isLogoutTicket(ticket) || Date.now() - ticket.at > LOGOUT_TICKET_SECONDS * 1000) {
    return redirectResponse(`${siteOrigin}/`, clear);
  }
  try {
    // Discovery accepts only an https end-session endpoint, so the id token goes nowhere else.
    const shopifyLogout = new URL((await discover(settings, fetchImpl)).endSessionEndpoint);
    shopifyLogout.searchParams.set('id_token_hint', ticket.idToken);
    shopifyLogout.searchParams.set('post_logout_redirect_uri', ticket.returnTo);
    return redirectResponse(shopifyLogout.toString(), clear);
  } catch (error) {
    // The session here is already gone, so the customer goes back to the site; Shopify's own session stays.
    console.error('account logout: Shopify not logged out, its endpoints are unreachable', messageOf(error));
    return redirectResponse(ticket.returnTo, clear);
  }
}

/**
 * The session being logged out, for its id token. A KV failure is logged and the logout carries on without one: the
 * session is still ended here, only Shopify's own logout is skipped.
 */
async function sessionForLogout(sessions: AccountRequest['sessions'], sessionId: string): Promise<Session | null> {
  try {
    return await sessions.load(sessionId);
  } catch (error) {
    console.error('account logout: session not read, so Shopify is not logged out', messageOf(error));
    return null;
  }
}

/** Logout, step 1: ends the session here first, whatever Shopify does, and unlinks the cart. */
async function logout(
  { request, url, settings, sessions, sessionId, fetch: fetchImpl, siteOrigin }: AccountRequest,
  cors: Record<string, string>,
): Promise<Response> {
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
  let logoutUrl: string | null = null;
  if (session?.idToken) {
    const ticket: LogoutTicket = { idToken: session.idToken, returnTo, at: Date.now() };
    const sealed = await seal(settings.secret, 'logout', LOGOUT_COOKIE, ticket);
    headers.append('Set-Cookie', setCookie(LOGOUT_COOKIE, sealed, LOGOUT_TICKET_SECONDS));
    logoutUrl = `${url.origin}${BASE}/logout/go`;
  }
  return new Response(JSON.stringify({ loggedOut: true, logoutUrl }), { status: 200, headers });
}

/** Top-level navigations: no CORS; the cookies prove which browser it is. */
const NAVIGATIONS = new Map<string, (context: AccountRequest) => Promise<Response>>([
  ['GET /login', login],
  ['GET /callback', callback],
  ['GET /logout/go', logoutRedirect],
]);

/**
 * Where a top-level navigation that failed lands: the site, with `?account=error` for the page to report, and without
 * the login and logout cookies, so a stale pending login or ticket can't be retried.
 */
function navigationFailed(siteOrigin: string): Response {
  const headers = new Headers({ Location: `${siteOrigin}/?account=error`, ...NO_STORE });
  headers.append('Set-Cookie', setCookie(LOGIN_COOKIE, '', 0));
  headers.append('Set-Cookie', setCookie(LOGOUT_COOKIE, '', 0));
  return new Response(null, { status: 302, headers });
}

/**
 * Where the sessions live: the explicit memory map when the caller passes one, else the TETHER_SYNC namespace.
 *
 * @returns `null` when there is neither: a login could not be kept.
 */
function sessionStorage(env: Record<string, unknown>, memory: MemoryEntries | undefined): ExpiringStore | null {
  if (memory) return memoryAccountStore(memory);
  const namespace = kvBinding(env);
  return namespace ? kvAccountStore(namespace) : null;
}

/** The answer while accounts can't work; what is missing is only logged and shown by an authorized /check. */
const NOT_SET_UP = { error: 'accounts are not set up (see /check)' };

/**
 * Handles `/_tether/account/*`.
 *
 * @param env The Worker's env.
 * @param options `memory` keeps the sessions in that map instead of the TETHER_SYNC namespace, for tests and hosts
 *   other than Cloudflare.
 * @returns `null` when the path isn't an account route.
 */
export async function handleAccount(
  request: Request,
  env: Record<string, unknown>,
  { fetch: fetchImpl = globalThis.fetch, memory }: { fetch?: Fetch; memory?: MemoryEntries } = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${BASE}/`)) return null;
  const configured = accountSettings(env);
  if (!configured) return jsonResponse({ error: 'accounts are not set up' }, 404);
  const ready = readyAccountSettings(configured);
  if (ready.kind === 'not-ready') {
    console.error('account setup', ready.errors.map((problem) => problem.message).join('; '));
    return jsonResponse(NOT_SET_UP, 503);
  }
  const store = sessionStorage(env, memory);
  if (!store) {
    console.error('account setup: the TETHER_SYNC KV namespace is not bound, so no login can be kept');
    return jsonResponse(NOT_SET_UP, 503);
  }
  const { settings } = ready;
  const context: AccountRequest = {
    request,
    url,
    settings,
    sessions: createSessionStore({ store, settings, fetch: fetchImpl }),
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
    if (error instanceof BodyTooLarge) return jsonResponse({ error: 'too large' }, 413, cors ?? {});
    console.error('account', messageOf(error));
    return jsonResponse({ error: 'account error' }, 502, cors ?? {});
  }
}
