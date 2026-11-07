/** Every cart drawer on the page. */
export declare const drawers: () => HTMLElement[];
/** True while a drawer, or the drawer-less cart, is open. */
export declare function isOpen(): boolean;
/**
 * `aria-expanded` on the open buttons, and dialog semantics on the drawers unless their markup has its own. Each
 * drawer follows its own open class: a closed one is hidden from screen readers and inert, out of the Tab order like
 * a closed dialog, so nothing `aria-hidden` can take focus.
 */
export declare function syncDrawerAria(): void;
/**
 * Opens every drawer but `tether-cart-drawer="manual"` ones, which only the site opens, by adding the open class. On a
 * page whose drawers are all manual it does nothing.
 */
export declare function openCart(): void;
/** Closes every open drawer, `manual` ones included. */
export declare function closeCart(): void;
export declare function toggleCart(): void;
/**
 * Keeps Tab inside the open drawer (`cartFocus`): from the last focusable element it wraps to the first, with Shift
 * from the first to the last, and from outside the drawer it goes in. For a document `keydown` listener.
 */
export declare function trapFocus(event: KeyboardEvent): void;
