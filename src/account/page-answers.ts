/**
 * The account pages' answers as typed values: addresses, the order page, subscriptions and what a change returns. The
 * rules are answers.ts's: every selected field is kept, a missing one reads as `null`, and the ids the pages act on
 * are required.
 */
import {
  countOrZero,
  field,
  isRecord,
  listOf,
  nodesOf,
  numberOrNull,
  textList,
  textOrNull,
} from '../../server/src/shared/json.ts';
import { imageOrNull, moneyOrNull, toOrderLine } from '../../server/src/shared/account-orders.ts';
import type { AccountImage, AccountOrderLine } from '../../server/src/shared/account-orders.ts';
import type { Money } from '../shopify-values.ts';
import { requiredId, unexpected } from './answers.ts';

/** An address as the documents select it. */
export interface MailingAddress {
  id: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zoneCode: string | null;
  zip: string | null;
  country: string | null;
  countryCode: string | null;
  phoneNumber: string | null;
  /** One line per entry. */
  formatted: string[];
}
/** One of the customer's saved addresses. */
export type AccountAddress = MailingAddress & { id: string };
export type CustomerAddress = AccountAddress & { isDefault: boolean };
interface ReturnReason {
  id: string;
  name: string | null;
  handle: string | null;
}
/** A line of the order page's document. */
export type OrderDetailLine = AccountOrderLine & {
  id: string;
  name: string | null;
  sku: string | null;
  price: Money | null;
  totalPrice: Money | null;
  suggestedReturnReasonDefinitions: { nodes: ReturnReason[] };
};
interface Tracking {
  company: string | null;
  number: string | null;
  url: string | null;
}
export interface Fulfillment {
  id: string | null;
  status: string | null;
  createdAt: string | null;
  estimatedDeliveryAt: string | null;
  latestShipmentStatus: string | null;
  trackingInformation: Tracking[];
}
interface ReturnableLine {
  quantity: number;
  lineItem: { id: string } | null;
}
/** A return Shopify opened. */
export interface OpenedReturn {
  id: string;
  status: string | null;
}
/** The order page's document. */
export interface OrderDetail {
  id: string;
  name: string | null;
  number: number | null;
  processedAt: string | null;
  cancelledAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  statusPageUrl: string | null;
  requiresShipping: boolean | null;
  totalPrice: Money | null;
  subtotal: Money | null;
  totalShipping: Money | null;
  totalTax: Money | null;
  shippingAddress: MailingAddress | null;
  billingAddress: MailingAddress | null;
  lineItems: { nodes: OrderDetailLine[] };
  fulfillments: { nodes: Fulfillment[] };
  returnInformation: { returnableLineItems: { nodes: ReturnableLine[] } } | null;
  returns: { nodes: OpenedReturn[] };
}
export interface SubscriptionLine {
  id: string | null;
  name: string | null;
  title: string | null;
  variantTitle: string | null;
  quantity: number;
  sku: string | null;
  currentPrice: Money | null;
  lineDiscountedPrice: Money | null;
  image: AccountImage | null;
}
interface BillingCycle {
  cycleIndex: number | null;
  skipped: boolean;
  billingAttemptExpectedDate: string | null;
}
/** The subscriptions document. */
export interface SubscriptionContract {
  id: string;
  /** `ACTIVE`, `PAUSED`, `CANCELLED`, `EXPIRED` or `FAILED`. */
  status: string | null;
  nextBillingDate: string | null;
  currencyCode: string | null;
  deliveryPrice: Money | null;
  deliveryPolicy: { interval: string | null; intervalCount: { count: number } | null } | null;
  lines: { nodes: SubscriptionLine[] };
  upcomingBillingCycles: { nodes: BillingCycle[] };
}
export interface Profile {
  firstName: string | null;
  lastName: string | null;
}
/**
 * What a subscription action changed: the contract (pause, resume, cancel) or its next billing cycle (skip, unskip).
 */
export type SubscriptionChange =
  | { contract: { id: string | null; status: string | null } }
  | { billingCycle: { cycleIndex: number | null; skipped: boolean } };

function toMailingAddress(value: unknown): MailingAddress {
  const text = (name: string) => textOrNull(field(value, name));
  return {
    id: text('id'),
    firstName: text('firstName'),
    lastName: text('lastName'),
    company: text('company'),
    address1: text('address1'),
    address2: text('address2'),
    city: text('city'),
    province: text('province'),
    zoneCode: text('zoneCode'),
    zip: text('zip'),
    country: text('country'),
    countryCode: text('countryCode'),
    phoneNumber: text('phoneNumber'),
    formatted: textList(field(value, 'formatted')),
  };
}

const mailingAddressOrNull = (value: unknown): MailingAddress | null =>
  isRecord(value) ? toMailingAddress(value) : null;

/** @throws {TetherError} Without an id. */
export const toAccountAddress = (value: unknown): AccountAddress => ({
  ...toMailingAddress(value),
  id: requiredId(field(value, 'id'), 'address id'),
});

/**
 * @param value The addresses operation's list, each address with the `isDefault` it adds.
 * @throws {TetherError} For an address without an id.
 */
export const toCustomerAddresses = (value: unknown): CustomerAddress[] =>
  listOf(value, (address) => ({ ...toAccountAddress(address), isDefault: field(address, 'isDefault') === true }));

const toOrderDetailLine = (value: unknown): OrderDetailLine => ({
  ...toOrderLine(value),
  id: requiredId(field(value, 'id'), 'line item id'),
  name: textOrNull(field(value, 'name')),
  sku: textOrNull(field(value, 'sku')),
  price: moneyOrNull(field(value, 'price')),
  totalPrice: moneyOrNull(field(value, 'totalPrice')),
  suggestedReturnReasonDefinitions: nodesOf(field(value, 'suggestedReturnReasonDefinitions'), (reason) => ({
    id: requiredId(field(reason, 'id'), 'return reason id'),
    name: textOrNull(field(reason, 'name')),
    handle: textOrNull(field(reason, 'handle')),
  })),
});

const toFulfillment = (value: unknown): Fulfillment => ({
  id: textOrNull(field(value, 'id')),
  status: textOrNull(field(value, 'status')),
  createdAt: textOrNull(field(value, 'createdAt')),
  estimatedDeliveryAt: textOrNull(field(value, 'estimatedDeliveryAt')),
  latestShipmentStatus: textOrNull(field(value, 'latestShipmentStatus')),
  trackingInformation: listOf(field(value, 'trackingInformation'), (tracking) => ({
    company: textOrNull(field(tracking, 'company')),
    number: textOrNull(field(tracking, 'number')),
    url: textOrNull(field(tracking, 'url')),
  })),
});

function toReturnableLine(value: unknown): ReturnableLine {
  const lineId = textOrNull(field(field(value, 'lineItem'), 'id'));
  return { quantity: countOrZero(field(value, 'quantity')), lineItem: lineId === null ? null : { id: lineId } };
}

function toReturnInformation(value: unknown): OrderDetail['returnInformation'] {
  if (!isRecord(value)) return null;
  return { returnableLineItems: nodesOf(value['returnableLineItems'], toReturnableLine) };
}

/**
 * @param value The order operation's `order`.
 * @returns `null` when the customer has no such order.
 * @throws {TetherError} For an order, line, reason or return without an id.
 */
export function toOrderDetail(value: unknown): OrderDetail | null {
  if (!isRecord(value)) return null;
  const text = (name: string) => textOrNull(value[name]);
  const money = (name: string) => moneyOrNull(value[name]);
  const requiresShipping = value['requiresShipping'];
  return {
    id: requiredId(value['id'], 'order id'),
    name: text('name'),
    number: numberOrNull(value['number']),
    processedAt: text('processedAt'),
    cancelledAt: text('cancelledAt'),
    financialStatus: text('financialStatus'),
    fulfillmentStatus: text('fulfillmentStatus'),
    statusPageUrl: text('statusPageUrl'),
    requiresShipping: typeof requiresShipping === 'boolean' ? requiresShipping : null,
    totalPrice: money('totalPrice'),
    subtotal: money('subtotal'),
    totalShipping: money('totalShipping'),
    totalTax: money('totalTax'),
    shippingAddress: mailingAddressOrNull(value['shippingAddress']),
    billingAddress: mailingAddressOrNull(value['billingAddress']),
    lineItems: nodesOf(value['lineItems'], toOrderDetailLine),
    fulfillments: nodesOf(value['fulfillments'], toFulfillment),
    returnInformation: toReturnInformation(value['returnInformation']),
    returns: nodesOf(value['returns'], toReturn),
  };
}

const toSubscriptionLine = (value: unknown): SubscriptionLine => ({
  id: textOrNull(field(value, 'id')),
  name: textOrNull(field(value, 'name')),
  title: textOrNull(field(value, 'title')),
  variantTitle: textOrNull(field(value, 'variantTitle')),
  quantity: countOrZero(field(value, 'quantity')),
  sku: textOrNull(field(value, 'sku')),
  currentPrice: moneyOrNull(field(value, 'currentPrice')),
  lineDiscountedPrice: moneyOrNull(field(value, 'lineDiscountedPrice')),
  image: imageOrNull(field(value, 'image')),
});

const toBillingCycle = (value: unknown): BillingCycle => ({
  cycleIndex: numberOrNull(field(value, 'cycleIndex')),
  skipped: field(value, 'skipped') === true,
  billingAttemptExpectedDate: textOrNull(field(value, 'billingAttemptExpectedDate')),
});

function toDeliveryPolicy(value: unknown): SubscriptionContract['deliveryPolicy'] {
  if (!isRecord(value)) return null;
  const intervalCount = value['intervalCount'];
  return {
    interval: textOrNull(value['interval']),
    intervalCount: isRecord(intervalCount) ? { count: countOrZero(intervalCount['count']) } : null,
  };
}

/** @throws {TetherError} Without an id. */
const toSubscriptionContract = (value: unknown): SubscriptionContract => ({
  id: requiredId(field(value, 'id'), 'subscription id'),
  status: textOrNull(field(value, 'status')),
  nextBillingDate: textOrNull(field(value, 'nextBillingDate')),
  currencyCode: textOrNull(field(value, 'currencyCode')),
  deliveryPrice: moneyOrNull(field(value, 'deliveryPrice')),
  deliveryPolicy: toDeliveryPolicy(field(value, 'deliveryPolicy')),
  lines: nodesOf(field(value, 'lines'), toSubscriptionLine),
  upcomingBillingCycles: nodesOf(field(value, 'upcomingBillingCycles'), toBillingCycle),
});

/**
 * @param value The subscriptions operation's list.
 * @throws {TetherError} For a contract without an id.
 */
export const toSubscriptionContracts = (value: unknown): SubscriptionContract[] =>
  listOf(value, toSubscriptionContract);

/**
 * @param result The subscription operation's result.
 * @throws {TetherError} With neither a contract nor a billing cycle.
 */
export function toSubscriptionChange(result: Record<string, unknown>): SubscriptionChange {
  const { contract, billingCycle } = result;
  if (isRecord(contract)) {
    return { contract: { id: textOrNull(contract['id']), status: textOrNull(contract['status']) } };
  }
  if (isRecord(billingCycle)) {
    const { cycleIndex, skipped } = toBillingCycle(billingCycle);
    return { billingCycle: { cycleIndex, skipped } };
  }
  throw unexpected('changed subscription');
}

/** @throws {TetherError} Without an id. */
export function toReturn(value: unknown): OpenedReturn {
  return { id: requiredId(field(value, 'id'), 'return id'), status: textOrNull(field(value, 'status')) };
}

/** @throws {TetherError} Without an id. */
export const toDeletedId = (value: unknown): string => requiredId(value, 'deleted address id');

/** @param value The profile operation's `customer`. */
export const toProfile = (value: unknown): Profile => ({
  firstName: textOrNull(field(value, 'firstName')),
  lastName: textOrNull(field(value, 'lastName')),
});
