import type { CartWarning } from '../config.js';
import type { ShopifyCart, ShopifyCartLine, PendingQuantity } from './store.js';
/** What a render shows. */
interface CartView {
    cart: ShopifyCart | null;
    warnings: readonly CartWarning[];
    /** Line id → the quantity quick clicks asked for. */
    pending: ReadonlyMap<string, PendingQuantity>;
    /** The last load or change failed (`tether-show="cart-error"`). */
    failed: boolean;
}
/** @returns The quantity to show: the one asked for while an update is on its way. */
export declare const quantityOf: (line: ShopifyCartLine, pending: ReadonlyMap<string, PendingQuantity>) => number;
export declare function renderCart(view: CartView): void;
/** Shows the count a saved cart had on the last page in the cart counts the page left at 0, until it has loaded. */
export declare function showSavedCount(count: number): void;
export {};
