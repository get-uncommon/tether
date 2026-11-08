import type { AccountOrder } from '../../server/src/shared/account-orders.js';
/** How many orders `orders()` answers, and a `tether-orders` list shows, without being told. */
export declare const DEFAULT_ORDER_COUNT = 10;
/** The most orders one request asks for: the Worker answers no more. */
export declare const MAX_ORDER_COUNT = 50;
/** @returns True for a number of orders one request can ask for: a whole number from 1 to `MAX_ORDER_COUNT`. */
export declare const isOrderCount: (value: unknown) => value is number;
/**
 * Fills every `tether-orders` list in `root`. A failure is reported and leaves the lists empty, without claiming the
 * customer has no orders.
 */
export declare function renderOrderList(root: ParentNode, loadOrders: (first: number) => Promise<AccountOrder[]>): Promise<void>;
