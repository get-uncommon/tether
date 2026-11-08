/**
 * The customer's recent orders (`tether-orders`), with `tether-show="orders-loading"` while they load and
 * `orders-empty` when there are none yet.
 */
import { cfg, reportError } from '../config.ts';
import { isHttpsUrl } from '../shopify-values.ts';
import { formatDate, formatMoney, get, integerAttribute, qsa, repeat, sel, setImage, setText } from '../dom.ts';
import { ownValue, showIn } from './markup.ts';
import { fillLines } from './order-lines.ts';
import type { AccountOrder } from '../../server/src/shared/account-orders.ts';

/** How many orders `orders()` answers, and a `tether-orders` list shows, without being told. */
export const DEFAULT_ORDER_COUNT = 10;
/** The most orders one request asks for: the Worker answers no more. */
export const MAX_ORDER_COUNT = 50;

/** @returns True for a number of orders one request can ask for: a whole number from 1 to `MAX_ORDER_COUNT`. */
export const isOrderCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ORDER_COUNT;

/** @returns How many orders the list shows: its `tether-limit`, kept within what one request can ask for. */
const listLimit = (list: Element): number =>
  integerAttribute(list, 'limit', { min: 1, max: MAX_ORDER_COUNT, fallback: DEFAULT_ORDER_COUNT });

/**
 * @param gid `gid://shopify/Order/123`, possibly with a query.
 * @returns The numeric id at its end.
 */
const numericId = (gid: string): string => gid.replace(/\?.*$/, '').replace(/^.*\//, '');

/**
 * The order's page: the site's own (`account.orderUrl`, e.g. `/account/order?id={id}`, every `{id}` the numeric
 * order id), else Shopify's status page when it is https.
 */
function orderUrl(order: AccountOrder): string | null {
  const template = cfg.account?.orderUrl;
  if (template) return template.replaceAll('{id}', encodeURIComponent(numericId(order.id)));
  const statusPage = order.statusPageUrl;
  return statusPage !== null && isHttpsUrl(statusPage) ? statusPage : null;
}

/** @returns The text of each `tether-order-bind` value. */
const orderTexts = (order: AccountOrder): Record<string, string | undefined> => ({
  name: order.name ?? '',
  date: formatDate(order.processedAt),
  total: formatMoney(order.totalPrice),
  status: order.financialStatus?.toLowerCase(),
  fulfillment: order.fulfillmentStatus?.toLowerCase(),
  items: order.lineItems.nodes.map((line) => `${String(line.quantity)}× ${line.title ?? ''}`).join(', '),
});

/** @param node A copy of the list's template. */
function fillOrder(node: HTMLElement, order: AccountOrder): void {
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
 */
export async function renderOrderList(
  root: ParentNode,
  loadOrders: (first: number) => Promise<AccountOrder[]>,
): Promise<void> {
  const lists = qsa(root, sel('orders'));
  const first = lists[0];
  if (!first) return;
  showIn(root, 'show', { 'orders-loading': true, 'orders-empty': false });
  const limit = listLimit(first);
  /** `null` after a failure. */
  let orders: AccountOrder[] | null;
  try {
    orders = await loadOrders(limit);
  } catch (error) {
    reportError(error, 'orders');
    orders = null;
  }
  showIn(root, 'show', { 'orders-loading': false, 'orders-empty': orders?.length === 0 });
  lists.forEach((list) => {
    repeat(list, orders ?? [], fillOrder);
  });
}
