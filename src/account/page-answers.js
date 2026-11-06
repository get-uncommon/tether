/**
 * The account pages' answers as typed values: addresses, the order page, subscriptions and what a change returns. The
 * rules are answers.js's: every selected field is kept, a missing one reads as `null`, and the ids the pages act on
 * are required.
 */
import { field, isRecord } from '../../server/src/shared/json.js';
import {
  countOrZero,
  imageOrNull,
  listOf,
  moneyOrNull,
  nodesOf,
  numberOrNull,
  requiredId,
  textList,
  toOrderLine,
  unexpected,
} from './answers.js';
import { textOrNull } from './shared.js';
/** @import { Money } from '../shopify-values.js' */
/** @import { AccountImage, AccountOrderLine } from './answers.js' */

/**
 * @typedef {object} MailingAddress An address as the documents select it.
 * @property {string | null} id
 * @property {string | null} firstName
 * @property {string | null} lastName
 * @property {string | null} company
 * @property {string | null} address1
 * @property {string | null} address2
 * @property {string | null} city
 * @property {string | null} province
 * @property {string | null} zoneCode
 * @property {string | null} zip
 * @property {string | null} country
 * @property {string | null} countryCode
 * @property {string | null} phoneNumber
 * @property {string[]} formatted One line per entry.
 */
/** @typedef {MailingAddress & { id: string }} AccountAddress One of the customer's saved addresses. */
/** @typedef {AccountAddress & { isDefault: boolean }} CustomerAddress */
/** @typedef {{ id: string, name: string | null, handle: string | null }} ReturnReason */
/**
 * @typedef {AccountOrderLine & {
 *   id: string,
 *   name: string | null,
 *   sku: string | null,
 *   price: Money | null,
 *   totalPrice: Money | null,
 *   suggestedReturnReasonDefinitions: { nodes: ReturnReason[] },
 * }} OrderDetailLine A line of the order page's document.
 */
/** @typedef {{ company: string | null, number: string | null, url: string | null }} Tracking */
/**
 * @typedef {object} Fulfillment
 * @property {string | null} id
 * @property {string | null} status
 * @property {string | null} createdAt
 * @property {string | null} estimatedDeliveryAt
 * @property {string | null} latestShipmentStatus
 * @property {Tracking[]} trackingInformation
 */
/** @typedef {{ quantity: number, lineItem: { id: string } | null }} ReturnableLine */
/**
 * @typedef {object} OrderDetail The order page's document.
 * @property {string} id
 * @property {string | null} name
 * @property {number | null} number
 * @property {string | null} processedAt
 * @property {string | null} cancelledAt
 * @property {string | null} financialStatus
 * @property {string | null} fulfillmentStatus
 * @property {string | null} statusPageUrl
 * @property {boolean | null} requiresShipping
 * @property {Money | null} totalPrice
 * @property {Money | null} subtotal
 * @property {Money | null} totalShipping
 * @property {Money | null} totalTax
 * @property {MailingAddress | null} shippingAddress
 * @property {MailingAddress | null} billingAddress
 * @property {{ nodes: OrderDetailLine[] }} lineItems
 * @property {{ nodes: Fulfillment[] }} fulfillments
 * @property {{ returnableLineItems: { nodes: ReturnableLine[] } } | null} returnInformation
 * @property {{ nodes: { id: string, status: string | null }[] }} returns
 */
/**
 * @typedef {object} SubscriptionLine
 * @property {string | null} id
 * @property {string | null} name
 * @property {string | null} title
 * @property {string | null} variantTitle
 * @property {number} quantity
 * @property {string | null} sku
 * @property {Money | null} currentPrice
 * @property {Money | null} lineDiscountedPrice
 * @property {AccountImage | null} image
 */
/**
 * @typedef {object} BillingCycle
 * @property {number | null} cycleIndex
 * @property {boolean} skipped
 * @property {string | null} billingAttemptExpectedDate
 */
/**
 * @typedef {object} SubscriptionContract The subscriptions document.
 * @property {string} id
 * @property {string | null} status `ACTIVE`, `PAUSED`, `CANCELLED`, `EXPIRED` or `FAILED`.
 * @property {string | null} nextBillingDate
 * @property {string | null} currencyCode
 * @property {Money | null} deliveryPrice
 * @property {{ interval: string | null, intervalCount: { count: number } | null } | null} deliveryPolicy
 * @property {{ nodes: SubscriptionLine[] }} lines
 * @property {{ nodes: BillingCycle[] }} upcomingBillingCycles
 */
/**
 * @typedef {{ contract: { id: string | null, status: string | null } }
 *   | { billingCycle: { cycleIndex: number | null, skipped: boolean } }} SubscriptionChange
 *   What a subscription action changed: the contract (pause, resume, cancel) or its next billing cycle (skip, unskip).
 */

/**
 * @param {unknown} value
 * @returns {MailingAddress}
 */
function toMailingAddress(value) {
  const text = (/** @type {string} */ name) => textOrNull(field(value, name));
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

/**
 * @param {unknown} value
 * @returns {MailingAddress | null}
 */
const mailingAddressOrNull = (value) => (isRecord(value) ? toMailingAddress(value) : null);

/**
 * @param {unknown} value
 * @returns {AccountAddress}
 * @throws {TetherError} Without an id.
 */
export const toAccountAddress = (value) => ({
  ...toMailingAddress(value),
  id: requiredId(field(value, 'id'), 'address id'),
});

/**
 * @param {unknown} value The addresses operation's list, each address with the `isDefault` it adds.
 * @returns {CustomerAddress[]}
 * @throws {TetherError} For an address without an id.
 */
export const toCustomerAddresses = (value) =>
  listOf(value, (address) => ({ ...toAccountAddress(address), isDefault: field(address, 'isDefault') === true }));

/**
 * @param {unknown} value
 * @returns {OrderDetailLine}
 */
const toOrderDetailLine = (value) => ({
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

/**
 * @param {unknown} value
 * @returns {Fulfillment}
 */
const toFulfillment = (value) => ({
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

/**
 * @param {unknown} value
 * @returns {ReturnableLine}
 */
function toReturnableLine(value) {
  const lineId = textOrNull(field(field(value, 'lineItem'), 'id'));
  return { quantity: countOrZero(field(value, 'quantity')), lineItem: lineId === null ? null : { id: lineId } };
}

/**
 * @param {unknown} value
 * @returns {OrderDetail['returnInformation']}
 */
function toReturnInformation(value) {
  if (!isRecord(value)) return null;
  return { returnableLineItems: nodesOf(value['returnableLineItems'], toReturnableLine) };
}

/**
 * @param {unknown} value The order operation's `order`.
 * @returns {OrderDetail | null} `null` when the customer has no such order.
 * @throws {TetherError} For an order, line, reason or return without an id.
 */
export function toOrderDetail(value) {
  if (!isRecord(value)) return null;
  const text = (/** @type {string} */ name) => textOrNull(value[name]);
  const money = (/** @type {string} */ name) => moneyOrNull(value[name]);
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

/**
 * @param {unknown} value
 * @returns {SubscriptionLine}
 */
const toSubscriptionLine = (value) => ({
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

/**
 * @param {unknown} value
 * @returns {BillingCycle}
 */
const toBillingCycle = (value) => ({
  cycleIndex: numberOrNull(field(value, 'cycleIndex')),
  skipped: field(value, 'skipped') === true,
  billingAttemptExpectedDate: textOrNull(field(value, 'billingAttemptExpectedDate')),
});

/**
 * @param {unknown} value
 * @returns {SubscriptionContract['deliveryPolicy']}
 */
function toDeliveryPolicy(value) {
  if (!isRecord(value)) return null;
  const intervalCount = value['intervalCount'];
  return {
    interval: textOrNull(value['interval']),
    intervalCount: isRecord(intervalCount) ? { count: countOrZero(intervalCount['count']) } : null,
  };
}

/**
 * @param {unknown} value
 * @returns {SubscriptionContract}
 * @throws {TetherError} Without an id.
 */
const toSubscriptionContract = (value) => ({
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
 * @param {unknown} value The subscriptions operation's list.
 * @returns {SubscriptionContract[]}
 * @throws {TetherError} For a contract without an id.
 */
export const toSubscriptionContracts = (value) => listOf(value, toSubscriptionContract);

/**
 * @param {Record<string, unknown>} result The subscription operation's result.
 * @returns {SubscriptionChange}
 * @throws {TetherError} With neither a contract nor a billing cycle.
 */
export function toSubscriptionChange(result) {
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

/**
 * @param {unknown} value
 * @returns {{ id: string, status: string | null }}
 * @throws {TetherError} Without an id.
 */
export function toReturn(value) {
  return { id: requiredId(field(value, 'id'), 'return id'), status: textOrNull(field(value, 'status')) };
}

/**
 * @param {unknown} value
 * @returns {string}
 * @throws {TetherError} Without an id.
 */
export const toDeletedId = (value) => requiredId(value, 'deleted address id');

/**
 * @param {unknown} value The profile operation's `customer`.
 * @returns {{ firstName: string | null, lastName: string | null }}
 */
export const toProfile = (value) => ({
  firstName: textOrNull(field(value, 'firstName')),
  lastName: textOrNull(field(value, 'lastName')),
});
