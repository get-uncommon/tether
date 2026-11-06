/**
 * The Worker's routes for the customer account operations, the contract between the browser's account part and the
 * Worker: which method and path each operation has under `/_tether/account`, and which input fields it reads. The
 * operations themselves (their documents and input checks) run only in the Worker, in `account/operations.js`.
 */

/**
 * @typedef {'order' | 'addresses' | 'subscriptions' | 'profile' | 'saveAddress' | 'deleteAddress' | 'subscription'
 *   | 'requestReturn'} OperationName
 */
/** @typedef {'pause' | 'resume' | 'skip' | 'unskip' | 'cancel'} SubscriptionAction */
/** @typedef {Record<string, unknown>} OperationInput The fields a route reads, checked by the operation itself. */
/** @typedef {{ name: OperationName, input: OperationInput }} OperationCall */

/**
 * The input fields are read from the query string for a GET and from the JSON body for a POST.
 *
 * @template {OperationName} Name
 * @typedef {{ name: Name, method: 'GET' | 'POST', path: string, fields: readonly string[] }} OperationRoute
 */

/** @satisfies {{ [Name in OperationName]: OperationRoute<Name> }} */
export const OPERATION_ROUTES = {
  order: { name: 'order', method: 'GET', path: '/order', fields: ['id'] },
  addresses: { name: 'addresses', method: 'GET', path: '/addresses', fields: [] },
  subscriptions: { name: 'subscriptions', method: 'GET', path: '/subscriptions', fields: [] },
  profile: { name: 'profile', method: 'POST', path: '/profile', fields: ['firstName', 'lastName'] },
  saveAddress: { name: 'saveAddress', method: 'POST', path: '/address', fields: ['id', 'address', 'isDefault'] },
  deleteAddress: { name: 'deleteAddress', method: 'POST', path: '/address/delete', fields: ['id'] },
  subscription: { name: 'subscription', method: 'POST', path: '/subscription', fields: ['id', 'action'] },
  requestReturn: { name: 'requestReturn', method: 'POST', path: '/return', fields: ['orderId', 'lines'] },
};

/** The route of each `METHOD /path`. */
const ROUTE_BY_REQUEST = new Map(
  Object.values(OPERATION_ROUTES).map((route) => [`${route.method} ${route.path}`, route]),
);

/**
 * The operation a Worker request asks for, with its input read from the query string or the body.
 *
 * @param {string} method
 * @param {string} path The path under `/_tether/account`.
 * @param {URL} url
 * @param {Record<string, unknown>} body The JSON body of a POST; `{}` for a GET.
 * @returns {OperationCall | null} `null` when no operation has this method and path.
 */
export function operationCall(method, path, url, body) {
  const route = ROUTE_BY_REQUEST.get(`${method} ${path}`);
  if (!route) return null;
  /** @type {OperationInput} */
  const input = {};
  for (const name of route.fields) input[name] = route.method === 'GET' ? url.searchParams.get(name) : body[name];
  return { name: route.name, input };
}

/**
 * The method and path (with its query string, for a GET) the browser requests an operation with. A POST sends the
 * input as its JSON body.
 *
 * @param {OperationName} name
 * @param {OperationInput} input
 * @returns {{ method: 'GET' | 'POST', path: string }}
 */
export function operationRequest(name, input) {
  const route = OPERATION_ROUTES[name];
  if (route.method === 'POST') return { method: 'POST', path: route.path };
  const query = new URLSearchParams();
  for (const fieldName of route.fields) {
    const value = input[fieldName];
    if (typeof value === 'string' || typeof value === 'number') query.set(fieldName, String(value));
  }
  const search = query.toString();
  return { method: 'GET', path: search ? `${route.path}?${search}` : route.path };
}
