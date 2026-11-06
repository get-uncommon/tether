/**
 * The account pages' operations, the same fixed ones in both modes: the Worker's routes in server mode, the Customer
 * Account API directly in browser mode, with the documents and input checks of account-ops.js either way. Each
 * result is read into its typed shape (page-answers.js), so both modes return the same values and fail with the same
 * `TetherError` codes: `NOT_LOGGED_IN`, `INVALID` for input that account-ops.js or Shopify refuses, `NETWORK`, and
 * `HTTP_<status>` for a request that failed.
 */
import { TetherError } from '../client.js';
import { emit } from '../dom.js';
import { isRecord } from '../../server/src/shared/json.js';
import { ops, operationRequest, InputError } from '../../server/src/shared/account-ops.js';
import {
  toAccountAddress,
  toCustomerAddresses,
  toDeletedId,
  toOrderDetail,
  toProfile,
  toReturn,
  toSubscriptionChange,
  toSubscriptionContracts,
} from './page-answers.js';
/** @import { ServerAnswer, ServerRequest } from './server-client.js' */
/** @import { AccountCustomer } from './answers.js' */
/** @import { AccountAddress, CustomerAddress, OrderDetail, SubscriptionChange, SubscriptionContract } from './page-answers.js' */
/** @import { OperationName, SubscriptionAction } from '../../server/src/shared/account-ops.js' */

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

/**
 * @param {OperationName} name
 * @param {Record<string, unknown>} input
 * @returns {Promise<Record<string, unknown>>}
 */
async function runAtWorker(name, input) {
  const { serverFetch } = pagesContext();
  const { method, path } = operationRequest(name, input);
  const answer = await serverFetch(path, method === 'POST' ? { method, body: input } : {});
  if (answer.kind === 'logged-out') throw new TetherError('Not logged in', { code: 'NOT_LOGGED_IN', status: 401 });
  return answer.data;
}

/**
 * @param {OperationName} name
 * @param {Record<string, unknown>} input
 * @returns {Promise<Record<string, unknown>>}
 */
async function runInBrowser(name, input) {
  const { query } = pagesContext();
  try {
    return await ops[name](async (document, variables) => {
      const data = await query(document, variables);
      return isRecord(data) ? data : null;
    }, input);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    const { userErrors } = error;
    throw new TetherError(error.message, { code: 'INVALID', ...(userErrors.length > 0 && { userErrors }) });
  }
}

/**
 * @param {OperationName} name
 * @param {Record<string, unknown>} [input]
 * @returns {Promise<Record<string, unknown>>} The operation's result fields, read by the caller.
 * @throws {TetherError} With one of the codes in the file's comment.
 */
function run(name, input = {}) {
  return pagesContext().serverBase() ? runAtWorker(name, input) : runInBrowser(name, input);
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
  return toOrderDetail(result['order']);
}

/**
 * @param {{ firstName?: string, lastName?: string }} [fields]
 * @returns {Promise<{ firstName: string | null, lastName: string | null }>}
 */
export async function updateProfile({ firstName, lastName } = {}) {
  const result = await run('profile', { firstName, lastName });
  changed('profile');
  return toProfile(result['customer']);
}

/** @returns {Promise<CustomerAddress[]>} The customer's addresses, the default one marked `isDefault`. */
export async function addresses() {
  const result = await run('addresses');
  return toCustomerAddresses(result['addresses']);
}

/**
 * Creates an address, or updates the one with `id`; without fields, only makes it the default.
 *
 * @param {AddressFields | null} address
 * @param {{ id?: string | undefined, isDefault?: boolean }} [options]
 * @returns {Promise<AccountAddress>}
 */
export async function saveAddress(address, { id, isDefault } = {}) {
  const result = await run('saveAddress', { id, address, isDefault });
  changed('addresses');
  return toAccountAddress(result['address']);
}

/**
 * @param {string} id
 * @returns {Promise<string>} The deleted address's id.
 */
export async function deleteAddress(id) {
  const result = await run('deleteAddress', { id });
  changed('addresses');
  return toDeletedId(result['deleted']);
}

/** @returns {Promise<SubscriptionContract[]>} */
export async function subscriptions() {
  const result = await run('subscriptions');
  return toSubscriptionContracts(result['subscriptions']);
}

/**
 * @param {string | number} id
 * @param {SubscriptionAction} action
 * @returns {Promise<SubscriptionChange>} The changed contract or billing cycle.
 */
export async function subscriptionAction(id, action) {
  const result = await run('subscription', { id, action });
  changed('subscriptions');
  return toSubscriptionChange(result);
}

/**
 * @param {string | number} orderId
 * @param {ReturnLine[]} lines
 * @returns {Promise<{ id: string, status: string | null }>} The return Shopify opened.
 */
export async function requestReturn(orderId, lines) {
  const result = await run('requestReturn', { orderId, lines });
  changed('orders');
  return toReturn(result['return']);
}
