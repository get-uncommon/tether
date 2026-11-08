import type { AccountCustomer } from './account/answers.js';
import type { AccountOrder } from '../server/src/shared/account-orders.js';
import type { AddressFields, ReturnLine } from './account/operations.js';
import type { AccountAddress, CustomerAddress, OpenedReturn, OrderDetail, Profile, SubscriptionChange, SubscriptionContract } from './account/page-answers.js';
import type { SubscriptionAction } from '../server/src/shared/account-routes.js';
/** @returns True when the Worker last said a customer is logged in; false before it has been asked. */
export declare const isLoggedIn: () => boolean;
/**
 * Through the Worker to Shopify's login page; the visitor comes back to `returnTo`.
 *
 * @throws {TetherError} `NOT_CONFIGURED` without `account.server`.
 */
export declare function login({ returnTo, locale, }?: {
    returnTo?: string;
    locale?: string;
}): Promise<void>;
/**
 * @returns The logged-in customer, `null` when nobody is.
 * @throws {TetherError} When the Worker can't be reached or fails.
 */
export declare function customer(): Promise<AccountCustomer | null>;
/**
 * @param options `first`: a whole number from 1 to `MAX_ORDER_COUNT`.
 * @returns The customer's most recent orders, newest first; none when nobody is logged in.
 * @throws {TetherError} `INVALID` for another `first`, which is refused before any request; else when the Worker or
 *   Shopify can't answer.
 */
export declare function orders({ first }?: {
    first?: number;
}): Promise<AccountOrder[]>;
/**
 * Logs out here and at Shopify, and unlinks the cart. Sends `tether:account-logout`.
 *
 * @param options `returnTo`: where Shopify sends the visitor afterwards.
 */
export declare function logout({ returnTo, }?: {
    returnTo?: string;
}): Promise<void>;
/**
 * Fills the account markup in `root`: what shows when logged in or out, the customer, their orders, and the account
 * pages.
 */
export declare function render(root?: ParentNode): Promise<void>;
/** One of the customer's orders, in full (lines, totals, addresses, fulfillments, returns). */
export declare const order: (id: string | number) => Promise<OrderDetail | null>;
export declare const updateProfile: (fields?: {
    firstName?: string;
    lastName?: string;
}) => Promise<Profile>;
export declare const addresses: () => Promise<CustomerAddress[]>;
/** Creates an address, or updates the one with `id`. */
export declare const saveAddress: (address: AddressFields | null, options?: {
    id?: string;
    isDefault?: boolean;
}) => Promise<AccountAddress>;
export declare const deleteAddress: (id: string) => Promise<string>;
export declare const subscriptions: () => Promise<SubscriptionContract[]>;
export declare const subscriptionAction: (id: string | number, action: SubscriptionAction) => Promise<SubscriptionChange>;
export declare const requestReturn: (orderId: string | number, lines: ReturnLine[]) => Promise<OpenedReturn>;
/**
 * Called by the core on mount: on the first one, finishes a login that's coming back and lets the Worker link the
 * cart at checkout; then fills the page.
 */
export declare function mountAccount(root?: ParentNode): Promise<void>;
