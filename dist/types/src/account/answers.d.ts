/**
 * The Worker's account answers as typed values. The Worker passes on what Shopify answers to its fixed documents, and
 * each answer is read once, field by field. Every field a document selects is kept. One that is missing or of another
 * type reads as `null` (a list as empty, a count as 0): a page with one blank field is better than no page. The ids
 * the pages act on are required, and an answer without one is an error. This module reads what the account part
 * shows (the customer, their orders through the reader the Worker shares, Shopify's `userErrors`); page-answers.ts
 * reads the account pages' answers.
 */
import { TetherError } from '../client.js';
import type { UserError } from '../client.js';
import type { AccountOrder } from '../../server/src/shared/account-orders.js';
/** The logged-in customer. */
export interface AccountCustomer {
    /** The customer's gid; left out when the Worker's `/me` doesn't send it. */
    id?: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    emailAddress: {
        emailAddress: string;
    } | null;
    defaultAddress: {
        formatted: string[];
    } | null;
}
export declare const unexpected: (what: string) => TetherError;
/**
 * @param what Named in the error.
 * @throws {TetherError} Without an id.
 */
export declare function requiredId(value: unknown, what: string): string;
/** @param value The `customer` of the Worker's `/me`, which flattens the email and the default address. */
export declare function toAccountCustomer(value: unknown): AccountCustomer;
/**
 * @param value The `orders` of the Worker's `/orders`.
 * @throws {TetherError} For an order without an id.
 */
export declare function toAccountOrders(value: unknown): AccountOrder[];
/** @param value Shopify's `userErrors`, as Shopify or the Worker sends them. */
export declare const toUserErrors: (value: unknown) => UserError[];
