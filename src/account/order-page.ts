/**
 * The order page (`tether-order`): one order in full, with its lines, totals, addresses, shipments and what can be
 * returned. `tether-order-state` and `tether-order-show` follow the load: `loading`, then `ready`, `not-found` or
 * `error`.
 */
import { reportError } from '../config.ts';
import { isHttpsUrl } from '../shopify-values.ts';
import { attr, formatDate, formatMoney, get, qsa, repeat, sel, setText, show } from '../dom.ts';
import { addressText, bindsIn, enumText, ownValue, showIn } from './markup.ts';
import { fillLines } from './order-lines.ts';
import { order } from './operations.ts';
import type { Fulfillment, OrderDetail } from './page-answers.ts';

type OrderState = 'loading' | 'ready' | 'not-found' | 'error';

/** @returns The order `tether-order` names: an id, or `url:<param>` for one in the page's URL. */
function orderKey(el: HTMLElement): string | null {
  const raw = get(el, 'order') || '';
  if (!raw.startsWith('url:')) return raw;
  return new URL(window.location.href).searchParams.get(raw.slice('url:'.length) || 'id');
}

/** Every state but `ready`, which shows with the order. */
export function showOrderState(el: HTMLElement, state: Exclude<OrderState, 'ready'>): void {
  el.setAttribute(attr('order-state'), state);
  showIn(el, 'order-show', {
    loading: state === 'loading',
    ready: false,
    'not-found': state === 'not-found',
    error: state === 'error',
  });
}

/** @returns The text of each `tether-order-bind` value. */
const orderTexts = (detail: OrderDetail): Record<string, string> => ({
  name: detail.name ?? '',
  date: formatDate(detail.processedAt),
  total: formatMoney(detail.totalPrice),
  subtotal: formatMoney(detail.subtotal),
  shipping: formatMoney(detail.totalShipping),
  tax: formatMoney(detail.totalTax),
  status: enumText(detail.financialStatus),
  fulfillment: enumText(detail.fulfillmentStatus),
  'shipping-address': addressText(detail.shippingAddress),
  'billing-address': addressText(detail.billingAddress),
  items: detail.lineItems.nodes.map((line) => `${String(line.quantity)}× ${line.title || line.name || ''}`).join(', '),
  cancelled: formatDate(detail.cancelledAt),
});

/** One shipment row: its status and dates, and its tracking link, hidden without an https one. */
function fillFulfillment(row: HTMLElement, fulfillment: Fulfillment): void {
  const tracking = fulfillment.trackingInformation[0];
  const texts: Record<string, string> = {
    status: enumText(fulfillment.latestShipmentStatus || fulfillment.status),
    date: formatDate(fulfillment.createdAt),
    eta: formatDate(fulfillment.estimatedDeliveryAt),
    company: tracking?.company || '',
    number: tracking?.number || '',
  };
  bindsIn(row, 'fulfillment-bind').forEach((el) => {
    const key = get(el, 'fulfillment-bind') ?? '';
    if (key === 'url') {
      const url = tracking?.url ?? null;
      const linked = url !== null && isHttpsUrl(url);
      if (linked) el.setAttribute('href', url);
      show(el, linked);
      return;
    }
    const text = ownValue(texts, key);
    if (text !== undefined) setText(el, text);
  });
}

function fillOrder(el: HTMLElement, detail: OrderDetail): void {
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
      const statusPage = detail.statusPageUrl;
      if (statusPage !== null && isHttpsUrl(statusPage)) bind.setAttribute('href', statusPage);
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

/** Loads and renders the order `el` names. A failure is reported and shows the error state. */
export async function renderOrder(el: HTMLElement): Promise<void> {
  const key = orderKey(el);
  if (!key) {
    el.setAttribute(attr('order-state'), 'not-found');
    showIn(el, 'order-show', { 'not-found': true });
    return;
  }
  showOrderState(el, 'loading');
  let detail: OrderDetail | null;
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
