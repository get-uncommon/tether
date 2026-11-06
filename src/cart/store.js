/**
 * The cart on this page: what Shopify last said about it (`CartStatus`), the quantities quick clicks asked for, the
 * customer it belongs to, and the one queue every change goes through. A change of what the page shows goes through
 * here, so the document (`renderCart`) and the listeners (`tether:cart-updated`) always see the store's cart.
 */
import { cfg } from '../config.js';
import { emit } from '../dom.js';
import { isOpen } from './drawer.js';
import { renderCart, quantityOf, showSavedCount } from './render.js';
/** @import { CartWarning } from '../config.js' */
/** @import { Image } from '../fragments.js' */
/** @import { Money } from '../shopify-values.js' */

/** @typedef {{ key: string, value: string }} Attribute */
/**
 * @typedef {object} CartVariant A line's `merchandise`: Shopify's `Merchandise` union has only `ProductVariant`.
 * @property {string} id
 * @property {string} title
 * @property {string | null} sku
 * @property {boolean} availableForSale
 * @property {boolean} requiresShipping
 * @property {number | null} [quantityAvailable] Absent when the store's token can't read inventory.
 * @property {Image | null} image
 * @property {Money} price
 * @property {Money | null} compareAtPrice
 * @property {{ name: string, value: string }[]} selectedOptions
 * @property {{ id: string, title: string, handle: string, vendor: string, featuredImage: Image | null }} product
 */
/**
 * @typedef {object} LinePlanAllocation
 * @property {{ id: string, name: string, description: string | null, recurringDeliveries: boolean,
 *   options: { name: string, value: string }[] }} sellingPlan
 * @property {Money} checkoutChargeAmount
 * @property {{ price: Money, compareAtPrice: Money, perDeliveryPrice: Money }[]} priceAdjustments
 */
/**
 * @typedef {object} ShopifyCartLine
 * @property {string} id
 * @property {number} quantity
 * @property {Attribute[]} attributes
 * @property {{ totalAmount: Money, subtotalAmount: Money, amountPerQuantity: Money,
 *   compareAtAmountPerQuantity: Money | null }} cost
 * @property {{ discountedAmount: Money }[]} discountAllocations
 * @property {LinePlanAllocation | null} sellingPlanAllocation
 * @property {CartVariant} merchandise
 * @property {{ id: string, quantity: number, merchandise: { id: string, title: string,
 *   product: { title: string, handle: string } } }[]} [lineComponents] Only on a bundle (`ComponentizableCartLine`).
 */
/**
 * @typedef {object} ShopifyCart The fields of `fragment TetherCart`.
 * @property {string} id
 * @property {string} checkoutUrl
 * @property {number} totalQuantity
 * @property {string | null} note
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {Attribute[]} attributes
 * @property {{ countryCode: string | null, email: string | null }} buyerIdentity
 * @property {{ code: string, applicable: boolean }[]} discountCodes
 * @property {{ subtotalAmount: Money, totalAmount: Money, checkoutChargeAmount: Money }} cost
 * @property {{ nodes: ShopifyCartLine[] }} lines
 */

/**
 * @typedef {{ kind: 'unknown' }
 *   | { kind: 'empty' }
 *   | { kind: 'ready', cart: ShopifyCart }
 *   | { kind: 'error', error: unknown, cart: ShopifyCart | null }} CartStatus
 *   `unknown` until the saved cart has loaded (the page's own markup shows); `empty` without a cart (none saved, or
 *   Shopify no longer has it); `error` after a failed load or change, with the cart as Shopify last sent it.
 */

/** @typedef {{ quantity: number }} PendingQuantity What one quick +/- click asked for; a newer click replaces it. */

/**
 * @typedef {object} CustomerLink What the account part sets while a customer is logged in.
 * @property {string | null} accessToken The Customer Account API token: carts created now belong to the customer.
 * @property {(() => Promise<string | null>) | null} beforeCheckout The account's own checkout URL; `null` from it, or
 *   no function, uses the cart's.
 */

/**
 * @typedef {object} CartMeta The second argument of a `subscribe` listener.
 * @property {boolean} open
 * @property {number} count
 * @property {boolean} loaded
 * @property {CartWarning[]} warnings A copy of Shopify's notes on the last change.
 */

/** @type {CartStatus} */
let status = { kind: 'unknown' };

/** @type {readonly CartWarning[]} Shopify's notes on the last change. */
let warnings = [];

/** @type {Map<string, PendingQuantity>} Line id → what quick +/- clicks asked for, until Shopify has answered. */
export const pendingQuantities = new Map();

/** @type {CustomerLink} */
export const customer = { accessToken: null, beforeCheckout: null };

/** @returns {CartStatus} */
export const cartStatus = () => status;

/** @returns {ShopifyCart | null} The cart as Shopify last sent it. */
export function currentCart() {
  switch (status.kind) {
    case 'ready':
    case 'error':
      return status.cart;
    case 'unknown':
    case 'empty':
      return null;
  }
}

/** @returns {readonly CartWarning[]} */
export const currentWarnings = () => warnings;

/**
 * @param {ShopifyCart | null} cart
 * @returns {CartStatus}
 */
const statusOf = (cart) => (cart ? { kind: 'ready', cart } : { kind: 'empty' });

const seenKey = () => `${cfg.storageKey}:seen`;

/**
 * localStorage throws in private mode and where the visitor blocks site data: the cart then lasts for this page.
 *
 * @param {string} key
 * @returns {string | null}
 */
function readStorageIfAllowed(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Like `readStorageIfAllowed`: without storage, nothing is remembered.
 *
 * @param {string} key
 * @param {string | null} value `null` removes the key.
 */
function writeStorageIfAllowed(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: see readStorageIfAllowed.
  }
}

/** @returns {string | null} The id of the visitor's cart, kept across pages. */
export const savedCartId = () => readStorageIfAllowed(cfg.storageKey) || null;

/** Forgets the saved cart, which Shopify no longer has. */
export function forgetSavedCart() {
  writeStorageIfAllowed(cfg.storageKey, null);
}

/**
 * Keeps a cart Shopify sent without showing it, for an answer a newer change will replace.
 *
 * @param {ShopifyCart | null} cart
 */
export function keepQuietly(cart) {
  status = statusOf(cart);
  if (cart) writeStorageIfAllowed(cfg.storageKey, cart.id);
}

/** Renders the document with the store's cart. */
export function render() {
  renderCart({
    cart: currentCart(),
    warnings,
    pending: pendingQuantities,
    failed: status.kind === 'error',
  });
}

/**
 * @param {string} reason The `reason` of `tether:cart-updated`.
 */
export function announce(reason) {
  render();
  emit('cart-updated', { cart: currentCart(), reason });
}

/**
 * Keeps a cart Shopify sent after a change, shows it, and tells this page and the visitor's other tabs.
 *
 * @param {ShopifyCart | null} cart
 * @param {string} reason
 * @returns {ShopifyCart | null} `cart`.
 */
export function commit(cart, reason) {
  keepQuietly(cart);
  // Other tabs reload the cart on this storage event; the next page shows the count before its cart has loaded.
  writeStorageIfAllowed(seenKey(), `${Date.now()}|${cart?.totalQuantity ?? 0}`);
  announce(reason);
  return cart;
}

/**
 * The outcome of loading the saved cart: the cart, `null` when there is none, or the failure.
 *
 * @param {{ kind: 'loaded', cart: ShopifyCart | null } | { kind: 'failed', error: unknown }} outcome
 */
export function settleLoad(outcome) {
  status = outcome.kind === 'loaded' ? statusOf(outcome.cart) : { kind: 'error', error: outcome.error, cart: null };
  announce('load');
}

/**
 * Sets or clears the failure without rendering, for `Tether.cart.lastError`, which the public types declare writable.
 *
 * @param {unknown} error `null` or `undefined` clears it.
 */
export function setFailure(error) {
  const cart = currentCart();
  status = error == null ? statusOf(cart) : { kind: 'error', error, cart };
}

/** Until the saved cart has loaded, the counts show the count it had on the last page instead of the page's 0. */
export function showLastKnownCount() {
  if (status.kind !== 'unknown') return;
  const count = readStorageIfAllowed(seenKey())?.split('|')[1];
  if (count) showSavedCount(count);
}

/**
 * Sets Shopify's notes on the last change: each message once, in the site's words (`warningText`).
 *
 * @param {readonly CartWarning[]} notes
 */
export function setWarnings(notes) {
  warnings = notes
    .filter((note, index) => notes.findIndex((other) => other.message === note.message) === index)
    .map((note) => ({ ...note, message: cfg.warningText?.(note) || note.message }));
  if (warnings.length) emit('cart-warning', { warnings });
}

/** The queue only waits for a task: its result, or failure, reaches the caller through the promise `run` returns. */
const waitOnly = () => undefined;

/**
 * @returns {<T>(task: () => Promise<T>) => Promise<T>} A runner that starts each task once the one before has
 *   settled, whether it succeeded or failed.
 */
export function serial() {
  /** @type {Promise<unknown>} */
  let previous = Promise.resolve();
  return (task) => {
    const run = previous.then(task);
    previous = run.then(waitOnly, waitOnly);
    return run;
  };
}

const runInOrder = serial();

/**
 * Runs a cart change after the ones before it, so quick clicks never race. A failure sets the `error` status (shown by
 * `tether-show="cart-error"` until the next change succeeds), emits `tether:cart-error` and rejects.
 *
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export function enqueue(task) {
  return runInOrder(task).then(
    (value) => {
      if (status.kind === 'error') {
        status = statusOf(status.cart);
        render();
      }
      return value;
    },
    (/** @type {unknown} */ error) => {
      status = { kind: 'error', error, cart: currentCart() };
      render();
      emit('cart-error', { error });
      throw error;
    },
  );
}

/**
 * @param {ShopifyCartLine} line
 * @returns {number} The quantity to show for `line`.
 */
export const pendingQuantityOf = (line) => quantityOf(line, pendingQuantities);

/** @returns {CartMeta} */
const meta = () => ({
  open: isOpen(),
  count: currentCart()?.totalQuantity ?? 0,
  loaded: status.kind !== 'unknown',
  warnings: [...warnings],
});

/**
 * Calls `listener` now and after every change of the cart or the drawer.
 *
 * @param {(cart: ShopifyCart | null, meta: CartMeta) => void} listener
 * @returns {() => void} Stops listening.
 */
export function subscribe(listener) {
  const events = ['cart-updated', 'cart-toggled'].map((name) => `${cfg.prefix}:${name}`);
  const call = () => {
    listener(currentCart(), meta());
  };
  events.forEach((name) => {
    document.addEventListener(name, call);
  });
  call();
  return () => {
    events.forEach((name) => {
      document.removeEventListener(name, call);
    });
  };
}
