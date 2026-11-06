import type { AccountImage, AccountOrderLine } from '../../server/src/shared/account-orders.js';
import type { Money } from '../shopify-values.js';
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
export type AccountAddress = MailingAddress & {
    id: string;
};
export type CustomerAddress = AccountAddress & {
    isDefault: boolean;
};
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
    suggestedReturnReasonDefinitions: {
        nodes: ReturnReason[];
    };
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
    lineItem: {
        id: string;
    } | null;
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
    lineItems: {
        nodes: OrderDetailLine[];
    };
    fulfillments: {
        nodes: Fulfillment[];
    };
    returnInformation: {
        returnableLineItems: {
            nodes: ReturnableLine[];
        };
    } | null;
    returns: {
        nodes: OpenedReturn[];
    };
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
    deliveryPolicy: {
        interval: string | null;
        intervalCount: {
            count: number;
        } | null;
    } | null;
    lines: {
        nodes: SubscriptionLine[];
    };
    upcomingBillingCycles: {
        nodes: BillingCycle[];
    };
}
export interface Profile {
    firstName: string | null;
    lastName: string | null;
}
/** What a subscription action changed: the contract (pause, resume, cancel) or its next billing cycle (skip, unskip). */
export type SubscriptionChange = {
    contract: {
        id: string | null;
        status: string | null;
    };
} | {
    billingCycle: {
        cycleIndex: number | null;
        skipped: boolean;
    };
};
/** @throws {TetherError} Without an id. */
export declare const toAccountAddress: (value: unknown) => AccountAddress;
/**
 * @param value The addresses operation's list, each address with the `isDefault` it adds.
 * @throws {TetherError} For an address without an id.
 */
export declare const toCustomerAddresses: (value: unknown) => CustomerAddress[];
/**
 * @param value The order operation's `order`.
 * @returns `null` when the customer has no such order.
 * @throws {TetherError} For an order, line, reason or return without an id.
 */
export declare function toOrderDetail(value: unknown): OrderDetail | null;
/**
 * @param value The subscriptions operation's list.
 * @throws {TetherError} For a contract without an id.
 */
export declare const toSubscriptionContracts: (value: unknown) => SubscriptionContract[];
/**
 * @param result The subscription operation's result.
 * @throws {TetherError} With neither a contract nor a billing cycle.
 */
export declare function toSubscriptionChange(result: Record<string, unknown>): SubscriptionChange;
/** @throws {TetherError} Without an id. */
export declare function toReturn(value: unknown): OpenedReturn;
/** @throws {TetherError} Without an id. */
export declare const toDeletedId: (value: unknown) => string;
/** @param value The profile operation's `customer`. */
export declare const toProfile: (value: unknown) => Profile;
export {};
