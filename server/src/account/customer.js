/**
 * The account routes for the logged-in customer: `/me`, `/orders`, `/cart` and the operations in
 * `server/src/shared/account-ops.js`. Each runs with the customer's own access token, from the session the cookie
 * leads to; without one, it answers as logged out.
 */

/** @import { AccountRequest } from '../account.js' */
/** @import { OperationCall } from '../shared/account-ops.js' */
/** @import { Session } from './session.js' */

import { CUSTOMER_QUERY, ORDERS_QUERY } from '../shared/account-documents.js';
import { InputError, operationCall, ops } from '../shared/account-ops.js';
import { field, textOrNull } from '../shared/json.js';
import { customerQuery, discover, linkCart, UnauthorizedError } from './shopify.js';
import { CART_ID, jsonResponse, NO_STORE, readJsonObject, SESSION_COOKIE, setCookie } from './http.js';

/** Shopify refused the customer's access token: the session has been ended here too. */
class CustomerLoggedOut extends Error {}

/**
 * The logged-in customer's Customer Account API for one request.
 *
 * @param {AccountRequest} context
 * @param {Session} session
 * @param {string} sessionId
 * @returns {(query: string, variables: Record<string, unknown>) => Promise<Record<string, unknown>>}
 * @throws {CustomerLoggedOut} From the returned function, once Shopify refuses the token.
 */
function customerApi({ settings, sessions, fetch: fetchImpl, siteOrigin }, session, sessionId) {
  return async (query, variables) => {
    try {
      const discovery = await discover(settings, fetchImpl);
      return await customerQuery(discovery, session.access, query, variables, siteOrigin, fetchImpl);
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      await sessions.end(sessionId);
      throw new CustomerLoggedOut('Shopify ended the session');
    }
  };
}

/** @param {unknown} data */
function customerProfile(data) {
  const customer = field(data, 'customer');
  return {
    id: textOrNull(field(customer, 'id')),
    firstName: textOrNull(field(customer, 'firstName')),
    lastName: textOrNull(field(customer, 'lastName')),
    displayName: textOrNull(field(customer, 'displayName')),
    email: textOrNull(field(field(customer, 'emailAddress'), 'emailAddress')),
    address: textOrNull(field(field(customer, 'defaultAddress'), 'formatted')),
  };
}

/**
 * The logged-in customer of a request, with an access token that is good for a while.
 *
 * @typedef {{ session: Session, ask: ReturnType<typeof customerApi> }} Customer
 */

/**
 * @param {AccountRequest} context
 * @returns {Promise<Customer | null>} `null` when the request has no live session.
 */
async function customerOf(context) {
  const { sessions, sessionId, siteOrigin } = context;
  if (!sessionId) return null;
  const loaded = await sessions.load(sessionId);
  const session = loaded ? await sessions.fresh(sessionId, loaded, siteOrigin) : null;
  return session ? { session, ask: customerApi(context, session, sessionId) } : null;
}

/**
 * The answer to a request without a live session. `/me` answers 200, because "nobody is logged in" is its answer;
 * every route that returns the customer's data answers 401. A session cookie that no longer leads to a session is
 * cleared, so the browser stops sending it.
 *
 * @param {AccountRequest} context
 * @param {Record<string, string>} cors
 * @param {200 | 401} status
 * @param {Record<string, unknown>} [extra] Fields the route's logged-out answer has always carried.
 */
function loggedOut({ sessionId }, cors, status, extra = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json', ...NO_STORE, ...cors });
  if (sessionId) headers.append('Set-Cookie', setCookie(SESSION_COOKIE, '', 0));
  return new Response(JSON.stringify({ loggedIn: false, ...extra }), { status, headers });
}

/**
 * A route for the logged-in customer. `loggedOut` is its answer without a session.
 *
 * @typedef {object} CustomerRoute
 * @property {(context: AccountRequest, cors: Record<string, string>, customer: Customer) => Promise<Response>} answer
 * @property {{ status: 200 | 401, extra?: Record<string, unknown> }} loggedOut
 */

/** Orders per page when the request doesn't say, and at most. */
const DEFAULT_ORDERS = 10;
const MAX_ORDERS = 50;

/** @type {Map<string, CustomerRoute>} The routes besides the operations in account-ops.js. */
const CUSTOMER_ROUTES = new Map([
  [
    'GET /me',
    {
      loggedOut: { status: 200 },
      async answer(_context, cors, { ask }) {
        const data = await ask(CUSTOMER_QUERY, {});
        return jsonResponse({ loggedIn: true, customer: customerProfile(data) }, 200, cors);
      },
    },
  ],
  [
    'GET /orders',
    {
      loggedOut: { status: 401, extra: { orders: [] } },
      // The nodes are the fields ORDERS_QUERY selects, which the browser reads as they are.
      async answer({ url }, cors, { ask }) {
        const asked = parseInt(url.searchParams.get('first') ?? '', 10) || DEFAULT_ORDERS;
        const first = Math.max(1, Math.min(MAX_ORDERS, asked));
        const data = await ask(ORDERS_QUERY, { first });
        const list = field(field(field(data, 'customer'), 'orders'), 'nodes') ?? [];
        return jsonResponse({ loggedIn: true, orders: list }, 200, cors);
      },
    },
  ],
  [
    'POST /cart',
    {
      loggedOut: { status: 401 },
      async answer({ request, settings, fetch: fetchImpl }, cors, { session }) {
        const cartId = field(await readJsonObject(request), 'cartId');
        if (typeof cartId !== 'string' || !CART_ID.test(cartId)) return jsonResponse({ error: 'cartId' }, 400, cors);
        const checkoutUrl = await linkCart(settings, cartId, session.access, fetchImpl);
        return jsonResponse({ linked: Boolean(checkoutUrl), checkoutUrl }, 200, cors);
      },
    },
  ],
]);

/**
 * One of the fixed account operations (order detail, profile, addresses, subscriptions, returns).
 *
 * @type {(call: OperationCall) => CustomerRoute}
 */
const operationRoute = ({ name, input }) => ({
  loggedOut: { status: 401 },
  async answer(_context, cors, { ask }) {
    try {
      return jsonResponse({ ok: true, ...(await ops[name](ask, input)) }, 200, cors);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      const userErrors = error.userErrors.length ? error.userErrors : undefined;
      // `code` tells the browser this is refused input, not a missing route, whatever the status.
      return jsonResponse({ error: error.message, code: 'INVALID', userErrors }, error.status, cors);
    }
  },
});

/**
 * The routes that need a session, behind CORS and (for POST) the CSRF header.
 *
 * @param {AccountRequest} context
 * @param {Record<string, string>} cors
 * @param {string} path
 */
export async function customerRoute(context, cors, path) {
  const { method } = context.request;
  let route = CUSTOMER_ROUTES.get(`${method} ${path}`);
  if (!route) {
    const body = method === 'POST' ? await readJsonObject(context.request) : {};
    const call = operationCall(method, path, context.url, body);
    if (!call) return jsonResponse({ error: 'not found' }, 404, cors);
    route = operationRoute(call);
  }
  const { status, extra } = route.loggedOut;
  const customer = await customerOf(context);
  if (!customer) return loggedOut(context, cors, status, extra);
  try {
    return await route.answer(context, cors, customer);
  } catch (error) {
    if (!(error instanceof CustomerLoggedOut)) throw error;
    return loggedOut(context, cors, status, extra);
  }
}
