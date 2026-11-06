import type { AddressFields, ReturnLine, SubscriptionAction } from '../../server/src/shared/account-routes.js';
export type { AddressFields, ReturnLine };
import type { AccountAddress, CustomerAddress, OpenedReturn, OrderDetail, Profile, SubscriptionChange, SubscriptionContract } from './page-answers.js';
import type { ServerAnswer, ServerRequest } from './server-client.js';
import type { AccountCustomer } from './answers.js';
/** The account part's session, shared so both parts act as one customer. */
interface PagesContext {
    serverFetch: (path: string, request?: ServerRequest) => Promise<ServerAnswer>;
    customer: () => Promise<AccountCustomer | null>;
    bindCustomer: (root: ParentNode) => Promise<void>;
    /** Forgets the cached customer after a change of their data. */
    reset: () => void;
}
/** Called by the account part once, when it loads this part. */
export declare function setup(shared: PagesContext): void;
/** @throws {Error} Before `setup`: this part is only ever loaded by the account part, which calls it first. */
export declare function pagesContext(): PagesContext;
/**
 * One of the customer's orders, in full (lines, totals, addresses, fulfillments, returns).
 *
 * @param id A gid or the numeric order id.
 * @returns `null` when the customer has no such order.
 */
export declare function order(id: string | number): Promise<OrderDetail | null>;
export declare function updateProfile({ firstName, lastName, }?: {
    firstName?: string;
    lastName?: string;
}): Promise<Profile>;
/** @returns The customer's addresses, the default one marked `isDefault`. */
export declare function addresses(): Promise<CustomerAddress[]>;
/** Creates an address, or updates the one with `id`; without fields, only makes it the default. */
export declare function saveAddress(address: AddressFields | null, { id, isDefault }?: {
    id?: string | undefined;
    isDefault?: boolean;
}): Promise<AccountAddress>;
/** @returns The deleted address's id. */
export declare function deleteAddress(id: string): Promise<string>;
export declare function subscriptions(): Promise<SubscriptionContract[]>;
/** @returns The changed contract or billing cycle. */
export declare function subscriptionAction(id: string | number, action: SubscriptionAction): Promise<SubscriptionChange>;
export declare function requestReturn(orderId: string | number, lines: ReturnLine[]): Promise<OpenedReturn>;
