/**
 * A customer's orders as typed values, read from the Customer Account API's answer to the orders document. The Worker
 * reads Shopify's answer with it before `/orders` sends it on, and the browser reads `/orders` with it again where the
 * answer arrives, so both hold the same shape. Every selected field is kept; one that is missing or of another type
 * reads as `null` (a list as empty, a count as 0). The order id is required: the pages link to it.
 */
import { asList, countOrZero, field, nodesOf, textOrNull } from './json.ts';

/** A `MoneyV2`. */
interface Money {
  amount: string;
  currencyCode: string;
}

export interface AccountImage {
  url: string;
  altText: string | null;
}

/** A line of an order. */
export interface AccountOrderLine {
  title: string | null;
  variantTitle: string | null;
  quantity: number;
  image: AccountImage | null;
}

/** An order in the customer's list. */
export interface AccountOrder {
  id: string;
  name: string | null;
  processedAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  statusPageUrl: string | null;
  totalPrice: Money | null;
  lineItems: { nodes: AccountOrderLine[] };
}

/** `missing-id` when an order has no id, which each side reports in its own error type. */
type OrdersReading = { kind: 'read'; orders: AccountOrder[] } | { kind: 'missing-id' };

export function moneyOrNull(value: unknown): Money | null {
  const amount = textOrNull(field(value, 'amount'));
  const currencyCode = textOrNull(field(value, 'currencyCode'));
  return amount === null || currencyCode === null ? null : { amount, currencyCode };
}

export function imageOrNull(value: unknown): AccountImage | null {
  const url = textOrNull(field(value, 'url'));
  return url === null ? null : { url, altText: textOrNull(field(value, 'altText')) };
}

export const toOrderLine = (value: unknown): AccountOrderLine => ({
  title: textOrNull(field(value, 'title')),
  variantTitle: textOrNull(field(value, 'variantTitle')),
  quantity: countOrZero(field(value, 'quantity')),
  image: imageOrNull(field(value, 'image')),
});

/**
 * @param id The order's id, read already.
 */
const toAccountOrder = (value: unknown, id: string): AccountOrder => ({
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
 * @param value A list of orders: Shopify's `orders.nodes`, or the `orders` of the Worker's `/orders`.
 */
export function readOrders(value: unknown): OrdersReading {
  const orders: AccountOrder[] = [];
  for (const item of asList(value)) {
    const id = textOrNull(field(item, 'id'));
    if (id === null) return { kind: 'missing-id' };
    orders.push(toAccountOrder(item, id));
  }
  return { kind: 'read', orders };
}
