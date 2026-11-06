/**
 * The cart drawer: every `[tether-cart-drawer]` on the page opens and closes together, as a modal dialog. Focus moves
 * into the open cart, Tab stays inside it and focus returns on close (`cartFocus`). A page without a drawer (a cart
 * built in React, Svelte or Vue) still has an open state, for `Tether.cart.subscribe`.
 */
import { cfg } from '../config.js';
import { sel, get, qsa, emit } from '../dom.js';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Long enough for the drawer's open transition to make its content visible: hidden elements can't take focus. */
const FOCUS_AFTER_OPEN_MS = 60;

/** The open state of a page without a drawer element. */
let openWithoutDrawer = false;

/** @type {HTMLElement | null} Where focus was before the cart opened. */
let returnFocus = null;

/**
 * @param {Element | null} el
 * @returns {el is HTMLElement}
 */
const isFocusable = (el) => el !== null && 'focus' in el;

/**
 * @param {ParentNode} drawer
 * @returns {HTMLElement[]} The visible focusable elements inside `drawer`, in document order.
 */
export const focusables = (drawer) =>
  qsa(drawer, FOCUSABLE).filter((el) => el.offsetParent !== null || el === document.activeElement);

/** @returns {HTMLElement[]} Every cart drawer on the page. */
export const drawers = () => qsa(document, sel('cart-drawer'));

/** @param {HTMLElement} drawer */
const isOpenDrawer = (drawer) => drawer.classList.contains(cfg.cartDrawerOpenClass);

/** @returns {boolean} True while a drawer, or the drawer-less cart, is open. */
export function isOpen() {
  const all = drawers();
  return all.length ? all.some(isOpenDrawer) : openWithoutDrawer;
}

/**
 * `aria-expanded` on the open buttons, and dialog semantics on the drawers unless their markup has its own. A closed
 * drawer is hidden from screen readers and, with `cartFocus`, out of the Tab order (inert), like a closed dialog.
 *
 * @param {boolean} open
 */
export function syncDrawerAria(open) {
  qsa(document, sel('cart-open')).forEach((button) => {
    button.setAttribute('aria-expanded', String(open));
  });
  drawers().forEach((drawer) => {
    if (!drawer.hasAttribute('role')) drawer.setAttribute('role', 'dialog');
    if (!drawer.hasAttribute('aria-label') && !drawer.hasAttribute('aria-labelledby')) {
      drawer.setAttribute('aria-label', get(drawer, 'cart-label') || 'Cart');
    }
    drawer.setAttribute('aria-modal', String(open));
    if (isOpenDrawer(drawer)) return;
    drawer.setAttribute('aria-hidden', 'true');
    if (cfg.cartFocus) drawer.inert = true;
  });
}

/** @param {HTMLElement} drawer */
function focusInto(drawer) {
  const target = focusables(drawer)[0] ?? drawer;
  if (target === drawer && !drawer.hasAttribute('tabindex')) drawer.tabIndex = -1;
  target.focus({ preventScroll: true });
}

/** Opens every drawer except `tether-cart-drawer="manual"` ones, which the site opens itself. */
export function openCart() {
  if (isOpen()) return;
  openWithoutDrawer = true;
  const opened = drawers().filter((drawer) => get(drawer, 'cart-drawer') !== 'manual');
  opened.forEach((drawer) => {
    drawer.inert = false;
    drawer.classList.add(cfg.cartDrawerOpenClass);
    drawer.setAttribute('aria-hidden', 'false');
  });
  syncDrawerAria(true);
  const [first] = opened;
  if (cfg.cartFocus && first) {
    returnFocus = isFocusable(document.activeElement) ? document.activeElement : null;
    setTimeout(() => {
      focusInto(first);
    }, FOCUS_AFTER_OPEN_MS);
  }
  cfg.onCartOpen?.(opened);
  emit('cart-toggled', { open: true });
}

export function closeCart() {
  if (!isOpen()) return;
  openWithoutDrawer = false;
  const all = drawers();
  const hadFocus = all.some((drawer) => drawer.contains(document.activeElement));
  all.forEach((drawer) => {
    drawer.classList.remove(cfg.cartDrawerOpenClass);
    drawer.setAttribute('aria-hidden', 'true');
    if (cfg.cartFocus) drawer.inert = true;
  });
  syncDrawerAria(false);
  if (hadFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
  cfg.onCartClose?.(all);
  emit('cart-toggled', { open: false });
}

export function toggleCart() {
  if (isOpen()) closeCart();
  else openCart();
}

/**
 * Keeps Tab inside the open drawer (`cartFocus`): from the last focusable element it wraps to the first, with Shift
 * from the first to the last, and from outside the drawer it goes in. For a document `keydown` listener.
 *
 * @param {KeyboardEvent} event
 */
export function trapFocus(event) {
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
