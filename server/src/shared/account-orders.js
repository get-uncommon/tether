/**
 * A customer's orders as typed values, read from the Customer Account API's answer to the orders document. The Worker
 * reads Shopify's answer with it before `/orders` sends it on, and the browser reads `/orders` with it again where the
 * answer arrives, so both hold the same shape. Every selected field is kept; one that is missing or of another type
 * reads as `null` (a list as empty, a count as 0). The order id is required: the pages link to it.
 */
import { asList, countOrZero, field, nodesOf, textOrNull } from './json.js';

/** @typedef {{ amount: string, currencyCode: string }} Money A `MoneyV2`. */
/** @typedef {{ url: string, altText: string | null }} AccountImage */
/**
 * @typedef {object} AccountOrderLine A line of an order.
 * @property {string | null} title
 * @property {string | null} variantTitle
 * @property {number} quantity
 * @property {AccountImage | null} image
 */
/**
 * @typedef {object} AccountOrder An order in the customer's list.
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
 * @typedef {{ kind: 'read', orders: AccountOrder[] } | { kind: 'missing-id' }} OrdersReading `missing-id` when an
 *   order has no id, which each side reports in its own error type.
 */

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
 * @param {string} id The order's id, read already.
 * @returns {AccountOrder}
 */
const toAccountOrder = (value, id) => ({
  id,
  name: textOrNull(field(value, 'name')),
  processedAt: textOrNull(field(value, 'processedAt')),
  financialStatus: textOrNull(field(value, 'financialStatus')),
  fulfillmentStatus: textOrNull(field(value, 'fulfillmentStatus')),
  statusPageUrl: textOrNull(field(value, 'statusPageUrl')),
  totalPrice: moneyOrNull(field(value, 'totalPrice')),
  lineItems: nodesOf(field(value, 'lineItems'), toOrderLine),
});

/**
 * @param {unknown} value A list of orders: Shopify's `orders.nodes`, or the `orders` of the Worker's `/orders`.
 * @returns {OrdersReading}
 */
export function readOrders(value) {
  /** @type {AccountOrder[]} */
  const orders = [];
  for (const item of asList(value)) {
    const id = textOrNull(field(item, 'id'));
    if (id === null) return { kind: 'missing-id' };
    orders.push(toAccountOrder(item, id));
  }
  return { kind: 'read', orders };
}
