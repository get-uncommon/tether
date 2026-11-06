/**
 * The customer's recent orders (`tether-orders`), with `tether-show="orders-loading"` while they load and
 * `orders-empty` when there are none yet.
 */
import { reportError } from '../config.js';
import { orderUrl, localDate } from '../account-links.js';
import { formatMoney, get, qsa, repeat, sel, setImage, setText } from '../dom.js';
import { ownValue, showIn } from './markup.js';
import { fillLines } from './order-lines.js';
/** @import { Money } from '../shopify-values.js' */
/** @import { OrderLine } from './order-lines.js' */

/**
 * @typedef {object} AccountOrder A node of `ORDERS_QUERY` (account-ops.js).
 * @property {string} id
 * @property {string} name
 * @property {string} processedAt
 * @property {string | null} financialStatus
 * @property {string | null} fulfillmentStatus
 * @property {string | null} statusPageUrl
 * @property {Money} totalPrice
 * @property {{ nodes: OrderLine[] }} lineItems
 */

/** How many orders a `tether-orders` list shows without `tether-limit`. */
const DEFAULT_ORDER_COUNT = 10;

/**
 * @param {AccountOrder} order
 * @returns {Record<string, string | undefined>} The text of each `tether-order-bind` value.
 */
const orderTexts = (order) => ({
  name: order.name,
  date: localDate(order.processedAt),
  total: formatMoney(order.totalPrice),
  status: order.financialStatus?.toLowerCase(),
  fulfillment: order.fulfillmentStatus?.toLowerCase(),
  items: order.lineItems.nodes.map((line) => `${line.quantity}× ${line.title}`).join(', '),
});

/**
 * @param {HTMLElement} node A copy of the list's template.
 * @param {AccountOrder} order
 */
function fillOrder(node, order) {
  const lines = order.lineItems.nodes;
  const url = orderUrl(order);
  const texts = orderTexts(order);
  qsa(node, sel('order-bind')).forEach((el) => {
    const key = get(el, 'order-bind') ?? '';
    if (key === 'url') {
      if (url) el.setAttribute('href', url);
      return;
    }
    if (key === 'image') {
      const image = lines.find((line) => line.image)?.image;
      if (image) setImage(el, image.url, image.altText || lines[0]?.title || '');
      return;
    }
    const text = ownValue(texts, key);
    if (text !== undefined) setText(el, text);
  });
  qsa(node, sel('order-lines')).forEach((box) => {
    fillLines(box, lines, null);
  });
  if (get(node, 'order-bind') === 'url' && url) node.setAttribute('href', url);
}

/**
 * Fills every `tether-orders` list in `root`. A failure is reported and leaves the lists empty, without claiming the
 * customer has no orders.
 *
 * @param {ParentNode} root
 * @param {(first: number) => Promise<AccountOrder[]>} loadOrders
 */
export async function renderOrderList(root, loadOrders) {
  const lists = qsa(root, sel('orders'));
  const first = lists[0];
  if (!first) return;
  showIn(root, 'show', { 'orders-loading': true, 'orders-empty': false });
  const limit = Number.parseInt(get(first, 'limit') || String(DEFAULT_ORDER_COUNT), 10) || DEFAULT_ORDER_COUNT;
  /** @type {AccountOrder[] | null} `null` after a failure. */
  const orders = await loadOrders(limit).catch((/** @type {unknown} */ error) => {
    reportError(error, 'orders');
    return null;
  });
  showIn(root, 'show', { 'orders-loading': false, 'orders-empty': orders?.length === 0 });
  lists.forEach((list) => {
    repeat(list, orders ?? [], fillOrder);
  });
}
