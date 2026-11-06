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
    lineItems: {
        nodes: AccountOrderLine[];
    };
}
/** `missing-id` when an order has no id, which each side reports in its own error type. */
type OrdersReading = {
    kind: 'read';
    orders: AccountOrder[];
} | {
    kind: 'missing-id';
};
export declare function moneyOrNull(value: unknown): Money | null;
export declare function imageOrNull(value: unknown): AccountImage | null;
export declare const toOrderLine: (value: unknown) => AccountOrderLine;
/**
 * @param value A list of orders: Shopify's `orders.nodes`, or the `orders` of the Worker's `/orders`.
 */
export declare function readOrders(value: unknown): OrdersReading;
export {};
