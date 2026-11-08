import type { ShopifyCart } from '../cart/store.js';
/** `[tether-group]` with `[tether-group-add]`: adds every product scope inside the group in one request. */
export declare const addGroup: (button: Element) => Promise<ShopifyCart | null>;
/** Binds the document-wide listeners, once per page load of the script. */
export declare function bindExtrasControls(): void;
