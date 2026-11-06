/** Every cart drawer on the page. */
export declare const drawers: () => HTMLElement[];
/** True while a drawer, or the drawer-less cart, is open. */
export declare function isOpen(): boolean;
/**
 * `aria-expanded` on the open buttons, and dialog semantics on the drawers unless their markup has its own. A closed
 * drawer is hidden from screen readers and, with `cartFocus`, out of the Tab order (inert), like a closed dialog.
 */
export declare function syncDrawerAria(open: boolean): void;
/** Opens every drawer except `tether-cart-drawer="manual"` ones, which the site opens itself. */
export declare function openCart(): void;
export declare function closeCart(): void;
export declare function toggleCart(): void;
/**
 * Keeps Tab inside the open drawer (`cartFocus`): from the last focusable element it wraps to the first, with Shift
 * from the first to the last, and from outside the drawer it goes in. For a document `keydown` listener.
 */
export declare function trapFocus(event: KeyboardEvent): void;
