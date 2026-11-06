/**
 * The Worker's account answers as typed values. The Worker passes on what Shopify answers to its fixed documents, and
 * each answer is read once, field by field. Every field a document selects is kept. One that is missing or of another
 * type reads as `null` (a list as empty, a count as 0): a page with one blank field is better than no page. The ids
 * the pages act on are required, and an answer without one is an error. This module reads what the account part
 * shows (the customer, their orders through the reader the Worker shares, Shopify's `userErrors`); page-answers.js
 * reads the account pages' answers.
 */
import { TetherError } from '../client.js';
import { field, isRecord, listOf, textList, textOrNull } from '../../server/src/shared/json.js';
import { readOrders } from '../../server/src/shared/account-orders.js';
/** @import { UserError } from '../client.js' */
/** @import { AccountOrder } from '../../server/src/shared/account-orders.js' */

/**
 * @typedef {object} AccountCustomer The logged-in customer.
 * @property {string} [id] The customer's gid; left out when the Worker's `/me` doesn't send it.
 * @property {string | null} firstName
 * @property {string | null} lastName
 * @property {string | null} displayName
 * @property {{ emailAddress: string } | null} emailAddress
 * @property {{ formatted: string[] } | null} defaultAddress
 */
/**
 * @param {string} what
 * @returns {TetherError}
 */
export const unexpected = (what) => new TetherError(`Customer accounts: the answer has no ${what}`);

/**
 * @param {unknown} value
 * @param {string} what Named in the error.
 * @returns {string}
 * @throws {TetherError} Without an id.
 */
export function requiredId(value, what) {
  const id = textOrNull(value);
  if (!id) throw unexpected(what);
  return id;
}

/**
 * @param {unknown} value The `customer` of the Worker's `/me`, which flattens the email and the default address.
 * @returns {AccountCustomer}
 */
export function toAccountCustomer(value) {
  const customer = isRecord(value) ? value : {};
  const id = textOrNull(customer['id']);
  const email = textOrNull(customer['email']);
  const address = customer['address'];
  return {
    ...(id === null ? {} : { id }),
    firstName: textOrNull(customer['firstName']),
    lastName: textOrNull(customer['lastName']),
    displayName: textOrNull(customer['displayName']),
    emailAddress: email === null ? null : { emailAddress: email },
    defaultAddress: Array.isArray(address) ? { formatted: textList(address) } : null,
  };
}

/**
 * @param {unknown} value The `orders` of the Worker's `/orders`.
 * @returns {AccountOrder[]}
 * @throws {TetherError} For an order without an id.
 */
export function toAccountOrders(value) {
  const reading = readOrders(value);
  if (reading.kind === 'missing-id') throw unexpected('order id');
  return reading.orders;
}

/**
 * @param {unknown} value
 * @returns {UserError | null} `null` for an entry without a message, which has nothing to show.
 */
function toUserError(value) {
  const message = textOrNull(field(value, 'message'));
  if (message === null) return null;
  const fieldPath = field(value, 'field');
  return {
    message,
    field: Array.isArray(fieldPath) ? textList(fieldPath) : null,
    code: textOrNull(field(value, 'code')),
  };
}

/**
 * @param {unknown} value Shopify's `userErrors`, as Shopify or the Worker sends them.
 * @returns {UserError[]}
 */
export const toUserErrors = (value) => listOf(value, toUserError).filter((error) => error !== null);
