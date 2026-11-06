/**
 * The account documents the browser's order list and profile need, apart from the operations in account-ops.js so
 * the browser's account part doesn't carry every operation's document.
 */

const MONEY = 'amount currencyCode';

/** The customer's profile, as `customer()` and `/me` return it. */
export const CUSTOMER_QUERY =
  'query TetherCustomer { customer { id firstName lastName displayName emailAddress { emailAddress } defaultAddress { formatted } } }';

/** The customer's recent orders, as `orders()` and `/orders` return them. */
export const ORDERS_QUERY = `query TetherOrders($first: Int!) { customer { orders(first: $first, sortKey: PROCESSED_AT, reverse: true) {
  nodes { id name processedAt financialStatus fulfillmentStatus statusPageUrl totalPrice { ${MONEY} }
    lineItems(first: 20) { nodes { title variantTitle quantity image { url altText } } } } } } }`;
