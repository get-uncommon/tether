/**
 * The Worker's routes for the customer account operations, the contract between the browser's account part and the
 * Worker: which method and path each operation has under `/_tether/account`, and which input fields it reads. The
 * operations themselves (their documents and input checks) run only in the Worker, in `account/operations.ts`.
 */

export type OperationName =
  | 'order'
  | 'addresses'
  | 'subscriptions'
  | 'profile'
  | 'saveAddress'
  | 'deleteAddress'
  | 'subscription'
  | 'requestReturn';
export type SubscriptionAction = 'pause' | 'resume' | 'skip' | 'unskip' | 'cancel';
/** The fields a route reads, checked by the operation itself. */
export type OperationInput = Record<string, unknown>;
export interface OperationCall {
  name: OperationName;
  input: OperationInput;
}

/** The input fields are read from the query string for a GET and from the JSON body for a POST. */
interface OperationRoute<Name extends OperationName> {
  name: Name;
  method: 'GET' | 'POST';
  path: string;
  fields: readonly string[];
}

export const OPERATION_ROUTES = {
  order: { name: 'order', method: 'GET', path: '/order', fields: ['id'] },
  addresses: { name: 'addresses', method: 'GET', path: '/addresses', fields: [] },
  subscriptions: { name: 'subscriptions', method: 'GET', path: '/subscriptions', fields: [] },
  profile: { name: 'profile', method: 'POST', path: '/profile', fields: ['firstName', 'lastName'] },
  saveAddress: { name: 'saveAddress', method: 'POST', path: '/address', fields: ['id', 'address', 'isDefault'] },
  deleteAddress: { name: 'deleteAddress', method: 'POST', path: '/address/delete', fields: ['id'] },
  subscription: { name: 'subscription', method: 'POST', path: '/subscription', fields: ['id', 'action'] },
  requestReturn: { name: 'requestReturn', method: 'POST', path: '/return', fields: ['orderId', 'lines'] },
} satisfies { [Name in OperationName]: OperationRoute<Name> };

/** The route of each `METHOD /path`. */
const ROUTE_BY_REQUEST = new Map<string, OperationRoute<OperationName>>(
  Object.values(OPERATION_ROUTES).map((route) => [`${route.method} ${route.path}`, route]),
);

/**
 * The operation a Worker request asks for, with its input read from the query string or the body.
 *
 * @param path The path under `/_tether/account`.
 * @param body The JSON body of a POST; `{}` for a GET.
 * @returns `null` when no operation has this method and path.
 */
export function operationCall(
  method: string,
  path: string,
  url: URL,
  body: Record<string, unknown>,
): OperationCall | null {
  const route = ROUTE_BY_REQUEST.get(`${method} ${path}`);
  if (!route) return null;
  const input: OperationInput = {};
  for (const name of route.fields) input[name] = route.method === 'GET' ? url.searchParams.get(name) : body[name];
  return { name: route.name, input };
}

/**
 * The method and path (with its query string, for a GET) the browser requests an operation with. A POST sends the
 * input as its JSON body.
 */
export function operationRequest(name: OperationName, input: OperationInput): { method: 'GET' | 'POST'; path: string } {
  const route: OperationRoute<OperationName> = OPERATION_ROUTES[name];
  if (route.method === 'POST') return { method: 'POST', path: route.path };
  const query = new URLSearchParams();
  for (const fieldName of route.fields) {
    const value = input[fieldName];
    if (typeof value === 'string' || typeof value === 'number') query.set(fieldName, String(value));
  }
  const search = query.toString();
  return { method: 'GET', path: search ? `${route.path}?${search}` : route.path };
}
