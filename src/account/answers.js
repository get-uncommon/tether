/**
 * The account answers as typed values. The Worker (server mode) and Shopify (browser mode) send the documents of
 * account-documents.js and account-ops.js, and each answer is read once, field by field, so both modes return the
 * same shapes. Every field a document selects is kept. One that is missing or of another type reads as `null` (a
 * list as empty, a count as 0): a page with one blank field is better than no page. The ids the pages act on are
 * required, and an answer without one is an error. This module reads what the account part shows (the customer,
 * their orders, Shopify's `userErrors`); page-answers.js reads the account pages' answers.
 */
import { TetherError } from '../client.js';
import { field, isRecord, textOrNull } from '../../server/src/shared/json.js';
/** @import { Money } from '../shopify-values.js' */
/** @import { UserError } from '../client.js' */

/** @typedef {{ url: string, altText: string | null }} AccountImage */
/**
 * @typedef {object} AccountCustomer The logged-in customer, the same in both modes.
 * @property {string} [id] The customer's gid; left out when the Worker's `/me` doesn't send it.
 * @property {string | null} firstName
 * @property {string | null} lastName
 * @property {string | null} displayName
 * @property {{ emailAddress: string } | null} emailAddress
 * @property {{ formatted: string[] } | null} defaultAddress
 */
/**
 * @typedef {object} AccountOrderLine A line of `ORDERS_QUERY`.
 * @property {string | null} title
 * @property {string | null} variantTitle
 * @property {number} quantity
 * @property {AccountImage | null} image
 */
/**
 * @typedef {object} AccountOrder A node of `ORDERS_QUERY`.
 * @property {string} id
 * @property {string | null} name
 * @property {string | null} processedAt
 * @property {string | null} financialStatus
 * @property {string | null} fulfillmentStatus
 * @property {string | null} statusPageUrl
 * @property {Money | null} totalPrice
 * @property {{ nodes: AccountOrderLine[] }} lineItems
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
 * @param {unknown} value
 * @returns {number | null}
 */
export const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * @param {unknown} value
 * @returns {number} A count Shopify always sends; 0 for an answer without it.
 */
export const countOrZero = (value) => numberOrNull(value) ?? 0;

/**
 * @template T
 * @param {unknown} value
 * @param {(item: unknown) => T} read
 * @returns {T[]}
 */
export const listOf = (value, read) => (Array.isArray(value) ? value.map((item) => read(item)) : []);

/**
 * @template T
 * @param {unknown} connection A GraphQL connection: `{ nodes: [...] }`.
 * @param {(item: unknown) => T} read
 * @returns {{ nodes: T[] }}
 */
export const nodesOf = (connection, read) => ({ nodes: listOf(field(connection, 'nodes'), read) });

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export const textList = (value) => listOf(value, textOrNull).filter((line) => line !== null);

/**
 * @param {unknown} value
 * @returns {Money | null}
 */
export function moneyOrNull(value) {
  const amount = textOrNull(field(value, 'amount'));
  const currencyCode = textOrNull(field(value, 'currencyCode'));
  return amount === null || currencyCode === null ? null : { amount, currencyCode };
}

/**
 * @param {unknown} value
 * @returns {AccountImage | null}
 */
export function imageOrNull(value) {
  const url = textOrNull(field(value, 'url'));
  return url === null ? null : { url, altText: textOrNull(field(value, 'altText')) };
}

/**
 * @param {Record<string, unknown>} customer
 * @param {{ email: string | null, address: string[] | null }} contact Read from where each mode's answer has them.
 * @returns {AccountCustomer}
 */
function customerFrom(customer, { email, address }) {
  const id = textOrNull(customer['id']);
  return {
    ...(id === null ? {} : { id }),
    firstName: textOrNull(customer['firstName']),
    lastName: textOrNull(customer['lastName']),
    displayName: textOrNull(customer['displayName']),
    emailAddress: email === null ? null : { emailAddress: email },
    defaultAddress: address === null ? null : { formatted: address },
  };
}

/**
 * @param {unknown} value The `customer` of `CUSTOMER_QUERY`.
 * @returns {AccountCustomer | null}
 */
export function toAccountCustomer(value) {
  if (!isRecord(value)) return null;
  const formatted = field(value['defaultAddress'], 'formatted');
  return customerFrom(value, {
    email: textOrNull(field(value['emailAddress'], 'emailAddress')),
    address: Array.isArray(formatted) ? textList(formatted) : null,
  });
}

/**
 * @param {unknown} value The `customer` of the Worker's `/me`, which flattens the email and the default address.
 * @returns {AccountCustomer}
 */
export function toServerCustomer(value) {
  const customer = isRecord(value) ? value : {};
  const address = customer['address'];
  return customerFrom(customer, {
    email: textOrNull(customer['email']),
    address: Array.isArray(address) ? textList(address) : null,
  });
}

/**
 * @param {unknown} value
 * @returns {AccountOrderLine}
 */
export const toOrderLine = (value) => ({
  title: textOrNull(field(value, 'title')),
  variantTitle: textOrNull(field(value, 'variantTitle')),
  quantity: countOrZero(field(value, 'quantity')),
  image: imageOrNull(field(value, 'image')),
});

/**
 * @param {unknown} value
 * @returns {AccountOrder}
 * @throws {TetherError} Without an id.
 */
const toAccountOrder = (value) => ({
  id: requiredId(field(value, 'id'), 'order id'),
  name: textOrNull(field(value, 'name')),
  processedAt: textOrNull(field(value, 'processedAt')),
  financialStatus: textOrNull(field(value, 'financialStatus')),
  fulfillmentStatus: textOrNull(field(value, 'fulfillmentStatus')),
  statusPageUrl: textOrNull(field(value, 'statusPageUrl')),
  totalPrice: moneyOrNull(field(value, 'totalPrice')),
  lineItems: nodesOf(field(value, 'lineItems'), toOrderLine),
});

/**
 * @param {unknown} value The nodes of `ORDERS_QUERY`.
 * @returns {AccountOrder[]}
 * @throws {TetherError} For an order without an id.
 */
export const toAccountOrders = (value) => listOf(value, toAccountOrder);

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
