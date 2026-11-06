/**
 * The account pages' operations, the same fixed ones in both modes: the Worker's routes in server mode, the Customer
 * Account API directly in browser mode, with the documents and input checks of account-ops.js either way. Each
 * result has the shape of its document there, which the typedefs of the views that render it state.
 */
import { TetherError } from '../client.js';
import { emit } from '../dom.js';
import { ops, InputError } from '../../server/src/shared/account-ops.js';
/** @import { ServerAnswer, ServerRequest } from './server-client.js' */
/** @import { AccountCustomer } from './browser-session.js' */
/** @import { OrderDetail } from './order-page.js' */
/** @import { CustomerAddress } from './addresses-view.js' */
/** @import { SubscriptionContract } from './subscriptions-view.js' */
/** @import { SubscriptionAction } from '../../server/src/shared/account-ops.js' */

/**
 * @typedef {object} PagesContext The account part's session, shared so both parts act as one customer.
 * @property {() => string} serverBase `''` in browser mode.
 * @property {(path: string, request?: ServerRequest) => Promise<ServerAnswer>} serverFetch
 * @property {(document: string, variables?: Record<string, unknown>) => Promise<unknown>} query
 * @property {() => Promise<AccountCustomer | null>} customer
 * @property {(root: ParentNode) => Promise<void>} bindCustomer
 * @property {() => void} reset Forgets the cached customer after a change of their data.
 */
/** @typedef {Record<string, unknown>} AddressFields `CustomerAddressInput` fields; account-ops.js keeps only those. */
/**
 * @typedef {object} ReturnLine
 * @property {string} lineItemId
 * @property {number} quantity
 * @property {string} [reasonId]
 * @property {string} [note]
 */
/** @typedef {'order' | 'addresses' | 'subscriptions' | 'profile' | 'saveAddress' | 'deleteAddress' | 'subscription' | 'requestReturn'} OperationName */
/** @typedef {'profile' | 'addresses' | 'subscriptions' | 'orders'} ChangedData `tether:account-updated`'s `what`. */

/** @type {PagesContext | null} */
let context = null;

/**
 * Called by the account part once, when it loads this part.
 *
 * @param {PagesContext} shared
 */
export function setup(shared) {
  context = shared;
}

/**
 * @returns {PagesContext}
 * @throws {Error} Before `setup`: this part is only ever loaded by the account part, which calls it first.
 */
export function pagesContext() {
  if (!context) throw new Error('account-pages: loaded without the account part');
  return context;
}

/** @type {Record<OperationName, (input: Record<string, unknown>) => ['GET' | 'POST', string]>} */
const ROUTE = {
  order: (input) => ['GET', `/order?id=${encodeURIComponent(String(input['id']))}`],
  addresses: () => ['GET', '/addresses'],
  subscriptions: () => ['GET', '/subscriptions'],
  profile: () => ['POST', '/profile'],
  saveAddress: () => ['POST', '/address'],
  deleteAddress: () => ['POST', '/address/delete'],
  subscription: () => ['POST', '/subscription'],
  requestReturn: () => ['POST', '/return'],
};

/**
 * @param {OperationName} name
 * @param {Record<string, unknown>} [input]
 * @returns {Promise<Record<string, unknown>>} The operation's result fields.
 * @throws {TetherError} `NOT_LOGGED_IN` (status 401), `INVALID` for input account-ops.js refuses (with Shopify's
 *   `userErrors`), or the request's failure.
 */
async function run(name, input = {}) {
  const { serverBase, serverFetch, query } = pagesContext();
  if (serverBase()) {
    const [method, path] = ROUTE[name](input);
    const answer = await serverFetch(path, method === 'POST' ? { method, body: input } : {});
    if (answer.kind === 'logged-out') throw new TetherError('Not logged in', { code: 'NOT_LOGGED_IN', status: 401 });
    return answer.data;
  }
  const operation = ops[name];
  if (!operation) throw new TetherError(`Customer accounts: no operation ${name}`);
  try {
    // account-ops.js's `Ask` reads every answer field by field, so the answer's shape needn't be stated here.
    return await operation(
      async (document, variables) => /** @type {Record<string, unknown> | null} */ (await query(document, variables)),
      input,
    );
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    throw new TetherError(error.message, { code: 'INVALID', userErrors: error.userErrors });
  }
}

/** @param {ChangedData} what */
function changed(what) {
  pagesContext().reset();
  emit('account-updated', { what });
}

/**
 * One of the customer's orders, in full (lines, totals, addresses, fulfillments, returns).
 *
 * @param {string | number} id A gid or the numeric order id.
 * @returns {Promise<OrderDetail | null>} `null` when the customer has no such order.
 */
export async function order(id) {
  const result = await run('order', { id });
  return /** @type {OrderDetail | null} */ (result['order'] ?? null);
}

/**
 * @param {{ firstName?: string, lastName?: string }} [fields]
 * @returns {Promise<{ firstName: string | null, lastName: string | null }>}
 */
export async function updateProfile({ firstName, lastName } = {}) {
  const result = await run('profile', { firstName, lastName });
  changed('profile');
  return /** @type {{ firstName: string | null, lastName: string | null }} */ (result['customer']);
}

/** @returns {Promise<CustomerAddress[]>} The customer's addresses, the default one marked `isDefault`. */
export async function addresses() {
  const result = await run('addresses');
  return /** @type {CustomerAddress[]} */ (result['addresses']);
}

/**
 * Creates an address, or updates the one with `id`; without fields, only makes it the default.
 *
 * @param {AddressFields | null} address
 * @param {{ id?: string | undefined, isDefault?: boolean }} [options]
 * @returns {Promise<CustomerAddress>}
 */
export async function saveAddress(address, { id, isDefault } = {}) {
  const result = await run('saveAddress', { id, address, isDefault });
  changed('addresses');
  return /** @type {CustomerAddress} */ (result['address']);
}

/**
 * @param {string} id
 * @returns {Promise<string>} The deleted address's id.
 */
export async function deleteAddress(id) {
  const result = await run('deleteAddress', { id });
  changed('addresses');
  return /** @type {string} */ (result['deleted']);
}

/** @returns {Promise<SubscriptionContract[]>} */
export async function subscriptions() {
  const result = await run('subscriptions');
  return /** @type {SubscriptionContract[]} */ (result['subscriptions']);
}

/**
 * @param {string | number} id
 * @param {SubscriptionAction} action
 * @returns {Promise<Record<string, unknown>>} The changed contract or billing cycle.
 */
export async function subscriptionAction(id, action) {
  const result = await run('subscription', { id, action });
  changed('subscriptions');
  return result;
}

/**
 * @param {string | number} orderId
 * @param {ReturnLine[]} lines
 * @returns {Promise<{ id: string, status: string }>} The return Shopify opened.
 */
export async function requestReturn(orderId, lines) {
  const result = await run('requestReturn', { orderId, lines });
  changed('orders');
  return /** @type {{ id: string, status: string }} */ (result['return']);
}
