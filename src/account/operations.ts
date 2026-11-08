/**
 * The account pages' operations: the Worker's fixed routes (shared/account-routes.ts), which check the input and run
 * the documents with the customer's token. Each result is read into its typed shape (page-answers.ts), and a failure
 * is a `TetherError`: `NOT_LOGGED_IN`, `INVALID` for input the Worker or Shopify refuses, `NETWORK`, and
 * `HTTP_<status>` for a request that failed.
 */
import { TetherError } from '../client.ts';
import { emit } from '../dom.ts';
import { operationRequest } from '../../server/src/shared/account-routes.ts';
import type {
  AddressFields,
  OperationInputs,
  OperationName,
  ReturnLine,
  SubscriptionAction,
} from '../../server/src/shared/account-routes.ts';

export type { AddressFields, ReturnLine };
import {
  toAccountAddress,
  toCustomerAddresses,
  toDeletedId,
  toOrderDetail,
  toProfile,
  toReturn,
  toSubscriptionChange,
  toSubscriptionContracts,
} from './page-answers.ts';
import type {
  AccountAddress,
  CustomerAddress,
  OpenedReturn,
  OrderDetail,
  Profile,
  SubscriptionChange,
  SubscriptionContract,
} from './page-answers.ts';
import type { ServerAnswer, ServerRequest } from './server-client.ts';
import type { AccountCustomer } from './answers.ts';

/** The account part's session, shared so both parts act as one customer. */
interface PagesContext {
  serverFetch: (path: string, request?: ServerRequest) => Promise<ServerAnswer>;
  customer: () => Promise<AccountCustomer | null>;
  bindCustomer: (root: ParentNode) => Promise<void>;
  /** Forgets the cached customer after a change of their data. */
  reset: () => void;
}

/** `tether:account-updated`'s `what`. */
type ChangedData = 'profile' | 'addresses' | 'subscriptions' | 'orders';

let context: PagesContext | null = null;

/** Called by the account part once, when it loads this part. */
export function setup(shared: PagesContext): void {
  context = shared;
}

/** @throws {Error} Before `setup`: this part is only ever loaded by the account part, which calls it first. */
export function pagesContext(): PagesContext {
  if (!context) throw new Error('account-pages: loaded without the account part');
  return context;
}

/**
 * @returns The operation's result fields, read by the caller.
 * @throws {TetherError} With one of the codes in the file's comment.
 */
async function run<Name extends OperationName>(
  name: Name,
  input: OperationInputs[Name],
): Promise<Record<string, unknown>> {
  const { serverFetch } = pagesContext();
  const { method, path } = operationRequest(name, input);
  const answer = await serverFetch(path, method === 'POST' ? { method, body: input } : {});
  if (answer.kind === 'logged-out') throw new TetherError('Not logged in', { code: 'NOT_LOGGED_IN', status: 401 });
  return answer.data;
}

function changed(what: ChangedData): void {
  pagesContext().reset();
  emit('account-updated', { what });
}

/**
 * One of the customer's orders, in full (lines, totals, addresses, fulfillments, returns).
 *
 * @param id A gid or the numeric order id.
 * @returns `null` when the customer has no such order.
 */
export async function order(id: string | number): Promise<OrderDetail | null> {
  const result = await run('order', { id });
  return toOrderDetail(result['order']);
}

export async function updateProfile({
  firstName,
  lastName,
}: { firstName?: string; lastName?: string } = {}): Promise<Profile> {
  const result = await run('profile', { firstName, lastName });
  changed('profile');
  return toProfile(result['customer']);
}

/** @returns The customer's addresses, the default one marked `isDefault`. */
export async function addresses(): Promise<CustomerAddress[]> {
  const result = await run('addresses', {});
  return toCustomerAddresses(result['addresses']);
}

/** Creates an address, or updates the one with `id`; without fields, only makes it the default. */
export async function saveAddress(
  address: AddressFields | null,
  { id, isDefault }: { id?: string | undefined; isDefault?: boolean } = {},
): Promise<AccountAddress> {
  const result = await run('saveAddress', { id, address, isDefault });
  changed('addresses');
  return toAccountAddress(result['address']);
}

/** @returns The deleted address's id. */
export async function deleteAddress(id: string): Promise<string> {
  const result = await run('deleteAddress', { id });
  changed('addresses');
  return toDeletedId(result['deleted']);
}

export async function subscriptions(): Promise<SubscriptionContract[]> {
  const result = await run('subscriptions', {});
  return toSubscriptionContracts(result['subscriptions']);
}

/** @returns The changed contract or billing cycle. */
export async function subscriptionAction(id: string | number, action: SubscriptionAction): Promise<SubscriptionChange> {
  const result = await run('subscription', { id, action });
  changed('subscriptions');
  return toSubscriptionChange(result);
}

export async function requestReturn(orderId: string | number, lines: ReturnLine[]): Promise<OpenedReturn> {
  const result = await run('requestReturn', { orderId, lines });
  changed('orders');
  return toReturn(result['return']);
}
