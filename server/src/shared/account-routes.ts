/**
 * The Worker's routes for the customer account operations, the contract between the browser's account part and the
 * Worker: what the browser sends for each operation, and which method and path it has under `/_tether/account`. The
 * operations themselves (their documents and input checks) run only in the Worker, in `account/operations.ts`.
 */

export type SubscriptionAction = 'pause' | 'resume' | 'skip' | 'unskip' | 'cancel';

/** Shopify's `CustomerAddressInput` fields; the Worker keeps only these, with bounded lengths. */
export interface AddressFields {
  firstName?: string;
  lastName?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  zip?: string;
  zoneCode?: string;
  /** Two letters. */
  countryCode?: string;
  phoneNumber?: string;
}

export interface ReturnLine {
  lineItemId: string;
  quantity: number;
  reasonId?: string;
  note?: string;
}

/** What the browser sends for each operation. Ids are gids, or the number at their end. */
export interface OperationInputs {
  order: { id: string | number };
  addresses: Record<string, never>;
  subscriptions: Record<string, never>;
  profile: { firstName?: string | undefined; lastName?: string | undefined };
  /** Without `id`, a new address; without fields, only makes the address the default. */
  saveAddress: { id?: string | undefined; address: AddressFields | null; isDefault?: boolean | undefined };
  deleteAddress: { id: string };
  subscription: { id: string | number; action: SubscriptionAction };
  requestReturn: { orderId: string | number; lines: ReturnLine[] };
}

export type OperationName = keyof OperationInputs;

/**
 * Each operation's input fields as they reach the Worker: from a browser, a page script or anyone else, so each value
 * is unchecked until the operation checks it.
 */
export type UncheckedInputs = {
  [Name in OperationName]: { readonly [Field in keyof OperationInputs[Name]]?: unknown };
};

/** One operation a Worker request asks for, with the fields its route reads, each one unchecked. */
export interface OperationCall {
  name: OperationName;
  input: Readonly<Record<string, unknown>>;
}

/** The input fields are read from the query string for a GET and from the JSON body for a POST. */
interface OperationRoute<Name extends OperationName> {
  name: Name;
  method: 'GET' | 'POST';
  path: string;
  /** Every field of the input, so one added to or renamed in {@link OperationInputs} and not here is a type error. */
  fields: Record<keyof OperationInputs[Name], true>;
}

export const OPERATION_ROUTES = {
  order: { name: 'order', method: 'GET', path: '/order', fields: { id: true } },
  addresses: { name: 'addresses', method: 'GET', path: '/addresses', fields: {} },
  subscriptions: { name: 'subscriptions', method: 'GET', path: '/subscriptions', fields: {} },
  profile: { name: 'profile', method: 'POST', path: '/profile', fields: { firstName: true, lastName: true } },
  saveAddress: {
    name: 'saveAddress',
    method: 'POST',
    path: '/address',
    fields: { id: true, address: true, isDefault: true },
  },
  deleteAddress: { name: 'deleteAddress', method: 'POST', path: '/address/delete', fields: { id: true } },
  subscription: { name: 'subscription', method: 'POST', path: '/subscription', fields: { id: true, action: true } },
  requestReturn: { name: 'requestReturn', method: 'POST', path: '/return', fields: { orderId: true, lines: true } },
} satisfies { [Name in OperationName]: OperationRoute<Name> };

/** A route of any operation, with its field names as plain strings. */
interface AnyRoute {
  name: OperationName;
  method: 'GET' | 'POST';
  path: string;
  fields: readonly string[];
}

/** The route of each `METHOD /path`. */
const ROUTE_BY_REQUEST = new Map<string, AnyRoute>(
  Object.values(OPERATION_ROUTES).map((route) => [
    `${route.method} ${route.path}`,
    { ...route, fields: Object.keys(route.fields) },
  ]),
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
  const input: Record<string, unknown> = {};
  for (const name of route.fields) input[name] = route.method === 'GET' ? url.searchParams.get(name) : body[name];
  return { name: route.name, input };
}

/**
 * The method and path (with its query string, for a GET) the browser requests an operation with. A POST sends the
 * input as its JSON body.
 */
export function operationRequest<Name extends OperationName>(
  name: Name,
  input: OperationInputs[Name],
): { method: 'GET' | 'POST'; path: string } {
  const route = OPERATION_ROUTES[name];
  if (route.method === 'POST') return { method: 'POST', path: route.path };
  const values: Readonly<Record<string, unknown>> = input;
  const query = new URLSearchParams();
  for (const fieldName of Object.keys(route.fields)) {
    const value = values[fieldName];
    if (typeof value === 'string' || typeof value === 'number') query.set(fieldName, String(value));
  }
  const search = query.toString();
  return { method: 'GET', path: search ? `${route.path}?${search}` : route.path };
}
