/**
 * The order page (`tether-order`): one order in full, with its lines, totals, addresses, shipments and what can be
 * returned. `tether-order-state` and `tether-order-show` follow the load: `loading`, then `ready`, `not-found` or
 * `error`.
 */
import { reportError } from '../config.js';
import { isHttpsUrl, localDate } from '../account-links.js';
import { attr, formatMoney, get, qsa, repeat, sel, setText, show } from '../dom.js';
import { addressText, bindsIn, enumText, ownValue, showIn } from './markup.js';
import { fillLines } from './order-lines.js';
import { order } from './operations.js';
/** @import { Money } from '../shopify-values.js' */
/** @import { OrderLine } from './order-lines.js' */

/**
 * @typedef {object} Fulfillment
 * @property {string} status
 * @property {string} createdAt
 * @property {string | null} estimatedDeliveryAt
 * @property {string | null} latestShipmentStatus
 * @property {{ company: string | null, number: string | null, url: string | null }[]} trackingInformation
 */
/**
 * @typedef {object} OrderDetail The order page's document in account-ops.js.
 * @property {string} id
 * @property {string} name
 * @property {string} processedAt
 * @property {string | null} cancelledAt
 * @property {string | null} financialStatus
 * @property {string | null} fulfillmentStatus
 * @property {string | null} statusPageUrl
 * @property {Money} totalPrice
 * @property {Money | null} subtotal
 * @property {Money | null} totalShipping
 * @property {Money | null} totalTax
 * @property {{ formatted: string[] } | null} shippingAddress
 * @property {{ formatted: string[] } | null} billingAddress
 * @property {{ nodes: (OrderLine & { id: string })[] }} lineItems
 * @property {{ nodes: Fulfillment[] }} fulfillments
 * @property {{ returnableLineItems: { nodes: { quantity: number, lineItem: { id: string } | null }[] } } | null}
 *   returnInformation
 * @property {{ nodes: { id: string, status: string }[] }} returns
 */
/** @typedef {'loading' | 'ready' | 'not-found' | 'error'} OrderState */

/**
 * @param {HTMLElement} el
 * @returns {string | null} The order `tether-order` names: an id, or `url:<param>` for one in the page's URL.
 */
function orderKey(el) {
  const raw = get(el, 'order') || '';
  if (!raw.startsWith('url:')) return raw;
  return new URL(window.location.href).searchParams.get(raw.slice('url:'.length) || 'id');
}

/**
 * Every state but `ready`, which shows with the order.
 *
 * @param {HTMLElement} el
 * @param {Exclude<OrderState, 'ready'>} state
 */
export function showOrderState(el, state) {
  el.setAttribute(attr('order-state'), state);
  showIn(el, 'order-show', {
    loading: state === 'loading',
    ready: false,
    'not-found': state === 'not-found',
    error: state === 'error',
  });
}

/**
 * @param {OrderDetail} detail
 * @returns {Record<string, string>} The text of each `tether-order-bind` value.
 */
const orderTexts = (detail) => ({
  name: detail.name,
  date: localDate(detail.processedAt),
  total: formatMoney(detail.totalPrice),
  subtotal: formatMoney(detail.subtotal),
  shipping: formatMoney(detail.totalShipping),
  tax: formatMoney(detail.totalTax),
  status: enumText(detail.financialStatus),
  fulfillment: enumText(detail.fulfillmentStatus),
  'shipping-address': addressText(detail.shippingAddress),
  'billing-address': addressText(detail.billingAddress),
  items: detail.lineItems.nodes.map((line) => `${line.quantity}× ${line.title || line.name}`).join(', '),
  cancelled: detail.cancelledAt ? localDate(detail.cancelledAt) : '',
});

/**
 * One shipment row: its status and dates, and its tracking link, hidden without an https one.
 *
 * @param {HTMLElement} row
 * @param {Fulfillment} fulfillment
 */
function fillFulfillment(row, fulfillment) {
  const tracking = fulfillment.trackingInformation[0];
  /** @type {Record<string, string>} */
  const texts = {
    status: enumText(fulfillment.latestShipmentStatus || fulfillment.status),
    date: localDate(fulfillment.createdAt),
    eta: fulfillment.estimatedDeliveryAt ? localDate(fulfillment.estimatedDeliveryAt) : '',
    company: tracking?.company || '',
    number: tracking?.number || '',
  };
  bindsIn(row, 'fulfillment-bind').forEach((el) => {
    const key = get(el, 'fulfillment-bind') ?? '';
    if (key === 'url') {
      const url = tracking?.url;
      const linked = isHttpsUrl(url);
      if (linked && url) el.setAttribute('href', url);
      show(el, linked);
      return;
    }
    const text = ownValue(texts, key);
    if (text !== undefined) setText(el, text);
  });
}

/**
 * @param {HTMLElement} el
 * @param {OrderDetail} detail
 */
function fillOrder(el, detail) {
  const returnable = new Map(
    (detail.returnInformation?.returnableLineItems.nodes ?? []).map((entry) => [
      entry.lineItem?.id ?? '',
      entry.quantity,
    ]),
  );
  const shipments = detail.fulfillments.nodes;
  const texts = orderTexts(detail);
  qsa(el, sel('order-bind')).forEach((bind) => {
    const key = get(bind, 'order-bind') ?? '';
    if (key === 'url') {
      if (detail.statusPageUrl && isHttpsUrl(detail.statusPageUrl)) bind.setAttribute('href', detail.statusPageUrl);
      return;
    }
    const text = ownValue(texts, key);
    if (text !== undefined) setText(bind, text);
  });
  qsa(el, sel('order-lines')).forEach((box) => {
    fillLines(box, detail.lineItems.nodes, returnable);
  });
  qsa(el, sel('order-fulfillments')).forEach((box) => {
    repeat(box, shipments, fillFulfillment);
  });
  const returnRequested = el.dataset['tetherReturned'] === '1';
  showIn(el, 'order-show', {
    loading: false,
    ready: true,
    error: false,
    'not-found': false,
    cancelled: Boolean(detail.cancelledAt),
    shipped: shipments.length > 0,
    returnable: [...returnable.values()].some((quantity) => quantity > 0),
    'has-returns': !returnRequested && detail.returns.nodes.length > 0,
    'return-requested': returnRequested,
  });
  el.setAttribute(attr('order-state'), 'ready');
}

/**
 * Loads and renders the order `el` names. A failure is reported and shows the error state.
 *
 * @param {HTMLElement} el
 */
export async function renderOrder(el) {
  const key = orderKey(el);
  if (!key) {
    el.setAttribute(attr('order-state'), 'not-found');
    showIn(el, 'order-show', { 'not-found': true });
    return;
  }
  showOrderState(el, 'loading');
  /** @type {OrderDetail | null} */
  let detail;
  try {
    detail = await order(key);
  } catch (error) {
    reportError(error, 'order');
    showOrderState(el, 'error');
    return;
  }
  if (!detail) {
    showOrderState(el, 'not-found');
    return;
  }
  el.dataset['tetherOrderId'] = detail.id;
  fillOrder(el, detail);
}
