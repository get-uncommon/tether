/**
 * The cart drawer: every `[tether-cart-drawer]` on the page opens and closes together, as a modal dialog. Focus moves
 * into the open cart, Tab stays inside it and focus returns on close (`cartFocus`). A `manual` drawer is opened by the
 * site, with the open class, and Tether follows the class. A page without a drawer (a cart built in React, Svelte or
 * Vue) still has an open state, for `Tether.cart.subscribe`.
 */
import { callHook, cfg } from '../config.ts';
import { sel, get, qsa, emit } from '../dom.ts';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Long enough for the drawer's open transition to make its content visible: hidden elements can't take focus. */
const FOCUS_AFTER_OPEN_MS = 60;

/** The open state of a page without a drawer element. */
let openWithoutDrawer = false;

/** The open state the page was last told about (`cart-toggled`, `onCartOpen`, `onCartClose`). */
let announcedOpen = false;

/** Where focus was before the cart opened. */
let returnFocus: HTMLElement | null = null;

/**
 * Follows the page from its first cart render on: a `manual` drawer the site opens or closes itself with the open
 * class, and an open drawer the site takes off the page, are announced.
 */
let pageWatcher: MutationObserver | null = null;

const isFocusable = (el: Element | null): el is HTMLElement => el !== null && 'focus' in el;

/** @returns The visible focusable elements inside `drawer`, in document order. */
const focusables = (drawer: ParentNode): HTMLElement[] =>
  qsa(drawer, FOCUSABLE).filter((el) => el.offsetParent !== null || el === document.activeElement);

/** Every cart drawer on the page. */
export const drawers = (): HTMLElement[] => qsa(document, sel('cart-drawer'));

/** A drawer is open while it has the open class, whether Tether or, for a `manual` one, the site added it. */
const isOpenDrawer = (drawer: HTMLElement) => drawer.classList.contains(cfg.cartDrawerOpenClass);

const hasFocusInside = (all: HTMLElement[]) => all.some((drawer) => drawer.contains(document.activeElement));

const isManual = (drawer: HTMLElement) => get(drawer, 'cart-drawer') === 'manual';

/**
 * True while a drawer, or the drawer-less cart, is open. The page watcher asks after every change to the page, so the
 * elements with the open class come first, from the browser's live class index: only a drawer-less open cart has the
 * drawers looked up.
 */
export function isOpen(): boolean {
  const openClassed = [...document.getElementsByClassName(cfg.cartDrawerOpenClass)];
  return openClassed.some((el) => el.matches(sel('cart-drawer'))) || (openWithoutDrawer && !drawers().length);
}

/** Announces an open state the page changed without Tether. */
function announceChange(): void {
  const open = isOpen();
  if (open === announcedOpen) return;
  const all = drawers();
  if (open) announceOpen(all.filter(isOpenDrawer));
  else announceClosed(all, hasFocusInside(all));
}

/**
 * `aria-expanded` on the open buttons, and dialog semantics on the drawers unless their markup has its own. Each
 * drawer follows its own open class: a closed one is hidden from screen readers and inert, out of the Tab order like
 * a closed dialog, so nothing `aria-hidden` can take focus.
 */
export function syncDrawerAria(): void {
  qsa(document, sel('cart-open')).forEach((button) => {
    button.setAttribute('aria-expanded', String(isOpen()));
  });
  drawers().forEach((drawer) => {
    if (!drawer.hasAttribute('role')) drawer.setAttribute('role', 'dialog');
    if (!drawer.hasAttribute('aria-label') && !drawer.hasAttribute('aria-labelledby')) {
      drawer.setAttribute('aria-label', get(drawer, 'cart-label') || 'Cart');
    }
    const open = isOpenDrawer(drawer);
    drawer.setAttribute('aria-modal', String(open));
    drawer.setAttribute('aria-hidden', String(!open));
    drawer.inert = !open;
  });
  if (pageWatcher) return;
  pageWatcher = new MutationObserver(announceChange);
  // The whole document, not the body: a router can replace the body element.
  pageWatcher.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  });
}

function focusInto(drawer: HTMLElement) {
  const target = focusables(drawer)[0] ?? drawer;
  if (target === drawer && !drawer.hasAttribute('tabindex')) drawer.tabIndex = -1;
  target.focus({ preventScroll: true });
}

function announceOpen(opened: HTMLElement[]): void {
  announcedOpen = true;
  syncDrawerAria();
  const [first] = opened;
  if (cfg.cartFocus && first) {
    returnFocus = isFocusable(document.activeElement) ? document.activeElement : null;
    setTimeout(() => {
      focusInto(first);
    }, FOCUS_AFTER_OPEN_MS);
  }
  callHook('onCartOpen', () => cfg.onCartOpen?.(opened));
  emit('cart-toggled', { open: true });
}

/** @param hadFocus Whether focus was inside a drawer as it closed, so it goes back to where it was before. */
function announceClosed(all: HTMLElement[], hadFocus: boolean): void {
  announcedOpen = false;
  openWithoutDrawer = false;
  syncDrawerAria();
  if (hadFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
  callHook('onCartClose', () => cfg.onCartClose?.(all));
  emit('cart-toggled', { open: false });
}

/**
 * Opens every drawer but `tether-cart-drawer="manual"` ones, which only the site opens, by adding the open class. On a
 * page whose drawers are all manual it does nothing.
 */
export function openCart(): void {
  if (isOpen()) return;
  const all = drawers();
  const opened = all.filter((drawer) => !isManual(drawer));
  if (all.length && !opened.length) return;
  // Drawers keep their own open state (the class), which the site can change: this flag is for a page without one.
  openWithoutDrawer = !all.length;
  opened.forEach((drawer) => {
    drawer.classList.add(cfg.cartDrawerOpenClass);
  });
  announceOpen(opened);
}

/** Closes every open drawer, `manual` ones included. */
export function closeCart(): void {
  if (!isOpen()) return;
  const all = drawers();
  const hadFocus = hasFocusInside(all);
  all.forEach((drawer) => {
    drawer.classList.remove(cfg.cartDrawerOpenClass);
  });
  announceClosed(all, hadFocus);
}

export function toggleCart(): void {
  if (isOpen()) closeCart();
  else openCart();
}

/**
 * Keeps Tab inside the open drawer (`cartFocus`): from the last focusable element it wraps to the first, with Shift
 * from the first to the last, and from outside the drawer it goes in. For a document `keydown` listener.
 */
export function trapFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !cfg.cartFocus || !isOpen()) return;
  const drawer = drawers().find(isOpenDrawer);
  if (!drawer) return;
  const inside = focusables(drawer);
  const first = inside[0];
  const last = inside.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  const leaving = event.shiftKey ? active === first : active === last;
  if (drawer.contains(active) && !leaving) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}
