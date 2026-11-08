/**
 * The Worker's account answers as typed values. The Worker passes on what Shopify answers to its fixed documents, and
 * each answer is read once, field by field. Every field a document selects is kept. One that is missing or of another
 * type reads as `null` (a list as empty, a count as 0): a page with one blank field is better than no page. The ids
 * the pages act on are required, and an answer without one is an error. This module reads what the account part
 * shows (the customer, their orders through the reader the Worker shares, Shopify's `userErrors`); page-answers.ts
 * reads the account pages' answers.
 */
import { TetherError } from '../client.ts';
import type { UserError } from '../client.ts';
import { field, isRecord, listOf, textList, textOrNull } from '../../server/src/shared/json.ts';
import { readOrders } from '../../server/src/shared/account-orders.ts';
import type { AccountOrder } from '../../server/src/shared/account-orders.ts';

/** The logged-in customer. */
export interface AccountCustomer {
  /** The customer's gid; left out when the Worker's `/me` doesn't send it. */
  id?: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  emailAddress: { emailAddress: string } | null;
  defaultAddress: { formatted: string[] } | null;
}

export const unexpected = (what: string): TetherError =>
  new TetherError(`Customer accounts: the answer has no ${what}`);

/**
 * @param what Named in the error.
 * @throws {TetherError} Without an id.
 */
export function requiredId(value: unknown, what: string): string {
  const id = textOrNull(value);
  if (!id) throw unexpected(what);
  return id;
}

/** @param value The `customer` of the Worker's `/me`, which flattens the email and the default address. */
export function toAccountCustomer(value: unknown): AccountCustomer {
  const customer = isRecord(value) ? value : {};
  const id = textOrNull(customer['id']);
  const email = textOrNull(customer['email']);
  const address = customer['address'];
  return {
    ...(id === null ? {} : { id }),
    firstName: textOrNull(customer['firstName']),
    lastName: textOrNull(customer['lastName']),
    displayName: textOrNull(customer['displayName']),
    emailAddress: email === null ? null : { emailAddress: email },
    defaultAddress: Array.isArray(address) ? { formatted: textList(address) } : null,
  };
}

/**
 * @param value The `orders` of the Worker's `/orders`.
 * @throws {TetherError} For an order without an id.
 */
export function toAccountOrders(value: unknown): AccountOrder[] {
  const reading = readOrders(value);
  if (reading.kind === 'missing-id') throw unexpected('order id');
  return reading.orders;
}

/** @returns `null` for an entry without a message, which has nothing to show. */
function toUserError(value: unknown): UserError | null {
  const message = textOrNull(field(value, 'message'));
  if (message === null) return null;
  const fieldPath = field(value, 'field');
  return {
    message,
    field: Array.isArray(fieldPath) ? textList(fieldPath) : null,
    code: textOrNull(field(value, 'code')),
  };
}

/** @param value Shopify's `userErrors`, as Shopify or the Worker sends them. */
export const toUserErrors = (value: unknown): UserError[] =>
  listOf(value, toUserError).filter((error) => error !== null);
