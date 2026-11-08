import type { AccountOrderLine } from '../../server/src/shared/account-orders.js';
import type { OrderDetailLine } from './page-answers.js';
/** A line of the order list, or of the order page, which has the fields after `image` too. */
type OrderLine = AccountOrderLine & Partial<Pick<OrderDetailLine, 'id' | 'name' | 'sku' | 'price' | 'totalPrice' | 'suggestedReturnReasonDefinitions'>>;
/** Line id → how many of it can still be returned. */
type Returnable = ReadonlyMap<string, number>;
/**
 * Renders `lines` into a `tether-order-lines` repeater.
 *
 * @param returns `null` for the order list.
 */
export declare function fillLines(box: HTMLElement, lines: readonly OrderLine[], returns: Returnable | null): void;
export {};
