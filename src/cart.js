/**
 * The cart, as one object: `Tether.cart`. Every change goes through one queue (fast clicks never race) and resolves
 * with the cart Shopify sent back. The state lives in `cart/store.js`, the Cart API calls in `cart/mutations.js`, the
 * drawer in `cart/drawer.js`, the document rendering in `cart/render.js` and the checkout in `cart/checkout.js`.
 */
import { cfg, reportError } from './config.js';
import { TetherError } from './client.js';
import { emit, toAttributes } from './dom.js';
import {
  fetchCart,
  isCartGone,
  mutateCart,
  removeLines,
  setLineQuantity,
  toLineInput,
  toLineUpdate,
  updateLines,
} from './cart/mutations.js';
import { checkout } from './cart/checkout.js';
import { drawers, isOpen, openCart, closeCart, toggleCart, trapFocus } from './cart/drawer.js';
import {
  announce,
  cartStatus,
  commit,
  currentCart,
  currentWarnings,
  customer,
  enqueue,
  forgetSavedCart,
  keepQuietly,
  pendingQuantities,
  pendingQuantityOf,
  render,
  savedCartId,
  setFailure,
  settleLoad,
  showLastKnownCount,
  subscribe,
} from './cart/store.js';
/** @import { CartWarning } from './config.js' */
/** @import { Attributes, LineSpec, CartLineInput, LinePatch } from './cart/mutations.js' */
/** @import { ShopifyCart, ShopifyCartLine, CustomerLink, CartStatus } from './cart/store.js' */

export { trapFocus };

/** @returns {readonly ShopifyCartLine[]} */
const currentLines = () => currentCart()?.lines.nodes ?? [];

/**
 * +1 / -1 for a line. Quick clicks add up: each builds on the quantity the click before asked for, which shows at once
 * (`tether-line="quantity"`, `quantityOf`) until Shopify has answered. Only the latest target is sent; the ones it
 * replaced are skipped.
 *
 * @param {string} lineId
 * @param {number} delta
 * @returns {Promise<ShopifyCart | null>}
 */
function changeQuantity(lineId, delta) {
  const line = currentLines().find((candidate) => candidate.id === lineId);
  if (!line) return Promise.resolve(currentCart());
  const target = Math.max(0, pendingQuantityOf(line) + delta);
  const job = { quantity: target };
  pendingQuantities.set(lineId, job);
  announce('pending');
  const isLatest = () => pendingQuantities.get(lineId) === job;
  const sent = enqueue(async () => {
    if (!isLatest()) return currentCart();
    const now = currentLines().find((candidate) => candidate.id === lineId);
    // A + then a -: Shopify already has the quantity.
    if (now?.quantity === target) return currentCart();
    const cart = await setLineQuantity(lineId, target);
    // A newer click is on its way: keep this answer, but show totals and count once that one is in, instead of
    // stepping through every reply.
    if (!isLatest()) {
      keepQuietly(cart);
      return cart;
    }
    return commit(cart, target > 0 ? 'update' : 'remove');
  });
  return sent.finally(() => {
    if (!isLatest()) return;
    pendingQuantities.delete(lineId);
    announce('settled');
  });
}

/**
 * The codes the cart has once a change is its turn in the queue.
 *
 * @param {string[] | string | ((current: string[]) => string[])} codes A function gets the codes as they are by then.
 * @returns {string[]}
 */
function discountCodesFrom(codes) {
  const current = (currentCart()?.discountCodes ?? []).map((discount) => discount.code);
  const list = typeof codes === 'function' ? codes(current) : codes;
  return (Array.isArray(list) ? list : [list]).map((code) => code.trim()).filter(Boolean);
}

/**
 * @param {Attributes} attributes
 * @returns {{ key: string, value: string }[]} The cart's attributes with `attributes` merged in; `''` removes a key.
 */
function mergedAttributes(attributes) {
  const merged = new Map((currentCart()?.attributes ?? []).map((attribute) => [attribute.key, attribute.value]));
  toAttributes(attributes).forEach((attribute) => merged.set(attribute.key, attribute.value));
  return [...merged].filter(([, value]) => value !== '').map(([key, value]) => ({ key, value }));
}

/**
 * Loads the saved cart. A cart Shopify no longer has is forgotten; one it can't be asked about (the network, the
 * token) is kept, because it is probably fine.
 *
 * @returns {Promise<ShopifyCart | null>}
 */
async function init() {
  const id = savedCartId();
  if (!id) {
    settleLoad({ kind: 'loaded', cart: null });
    return null;
  }
  showLastKnownCount();
  try {
    const cart = await fetchCart(id);
    if (!cart) forgetSavedCart();
    settleLoad({ kind: 'loaded', cart });
  } catch (error) {
    reportError(error, 'cart load failed');
    if (isCartGone(error)) forgetSavedCart();
    settleLoad({ kind: 'failed', error });
  }
  return currentCart();
}

export const Cart = {
  init,
  /** @returns {string | null} The saved cart's id. */
  id: savedCartId,

  /** @returns {CartStatus} */
  get status() {
    return cartStatus();
  },
  /** @returns {ShopifyCart | null} */
  get state() {
    return currentCart();
  },
  /** @returns {ShopifyCartLine[]} The cart's lines, a copy: changing it changes nothing in the cart. */
  get lines() {
    return [...currentLines()];
  },
  /** @returns {number} */
  get count() {
    return currentCart()?.totalQuantity ?? 0;
  },
  /** @returns {boolean} True once the saved cart, or that there is none, is known. */
  get loaded() {
    return cartStatus().kind !== 'unknown';
  },
  /**
   * @returns {Error | null} The failure of the last load or change, until a change succeeds. Requests fail with an
   *   `Error`; anything else thrown is wrapped, so the public type holds.
   */
  get lastError() {
    const current = cartStatus();
    if (current.kind !== 'error') return null;
    return current.error instanceof Error ? current.error : new Error(String(current.error));
  },
  set lastError(error) {
    setFailure(error);
  },
  /** @returns {CartWarning[]} Shopify's notes on the last change, a copy. */
  get warnings() {
    return [...currentWarnings()];
  },
  /** @returns {ReadonlyMap<string, { quantity: number }>} Line id → the quantity quick clicks asked for. */
  get pendingQty() {
    return pendingQuantities;
  },

  /** @returns {string | null} The logged-in customer's Customer Account API token (set by the account part). */
  get customerAccessToken() {
    return customer.accessToken;
  },
  set customerAccessToken(token) {
    customer.accessToken = token || null;
  },
  /** @returns {(() => Promise<string | null>) | null} The account's own checkout URL (set by the account part). */
  get beforeCheckout() {
    return customer.beforeCheckout;
  },
  set beforeCheckout(fetchUrl) {
    customer.beforeCheckout = typeof fetchUrl === 'function' ? fetchUrl : null;
  },
  /**
   * Links the cart to a logged-in customer, or unlinks it with `null`s. Carts created from now on belong to the
   * customer; `beforeCheckout` gives the checkout URL (`null` from it uses the cart's).
   *
   * @param {Partial<CustomerLink>} link Fields left out keep their value.
   */
  setCustomer(link) {
    if (link.accessToken !== undefined) customer.accessToken = link.accessToken;
    if (link.beforeCheckout !== undefined) customer.beforeCheckout = link.beforeCheckout;
  },

  /**
   * Forgets the saved cart on this device, as if there were none: the page shows an empty cart and
   * `tether:cart-updated` fires with reason `load`. The next add starts a new cart.
   */
  forgetSaved() {
    forgetSavedCart();
    settleLoad({ kind: 'loaded', cart: null });
  },

  /** Keeps a cart and shows it, as a change does; tests seed the cart with it. */
  _commit: commit,
  render,
  subscribe,

  /**
   * `add(variantId, 2)`, `add({ variantId, quantity, sellingPlanId, attributes })`, or `add([line, line])` for
   * bundles in one request. Creates the cart when there is none.
   *
   * @param {string | number | LineSpec | (string | number | LineSpec)[]} input
   * @param {number} [quantity]
   * @param {Omit<LineSpec, 'variantId' | 'quantity'>} [options]
   * @returns {Promise<ShopifyCart>}
   * @throws {TetherError} (rejected) When the add fails, or Shopify answers it without a cart.
   */
  add(input, quantity = 1, options = {}) {
    /** @type {CartLineInput[]} */
    const lines = (Array.isArray(input) ? input : [input]).map((line) => toLineInput(line, quantity, options));
    return enqueue(async () => {
      const cart = await mutateCart({
        name: 'cartLinesAdd',
        args: '$lines: [CartLineInput!]!',
        inner: 'lines: $lines',
        variables: { lines },
        createInput: { lines },
      });
      // A mutation answers without a cart only beside user errors, which reject above; an add always has one.
      if (!cart) throw new TetherError('Shopify answered the add without a cart');
      commit(cart, 'add');
      emit('added', { cart, lines });
      if (cfg.openCartOnAdd) openCart();
      return cart;
    });
  },

  /**
   * `updateLine(lineId, 3)` or `updateLine(lineId, { quantity, sellingPlanId, attributes })`.
   *
   * @param {string} lineId
   * @param {number | LinePatch} patch A quantity of 0 or less removes the line.
   * @returns {Promise<ShopifyCart | null>}
   */
  updateLine(lineId, patch) {
    const quantity = typeof patch === 'number' ? patch : patch.quantity;
    if (quantity !== undefined && quantity <= 0) return Cart.removeLine(lineId);
    const line = toLineUpdate(lineId, patch);
    return enqueue(async () => commit(await updateLines([line]), 'update'));
  },

  changeQuantity,

  /**
   * @param {ShopifyCartLine} line
   * @returns {number} The quantity to show: the one asked for while an update is on its way.
   */
  quantityOf: pendingQuantityOf,

  /**
   * @param {string | string[]} lineIds
   * @returns {Promise<ShopifyCart | null>}
   */
  removeLine(lineIds) {
    const ids = Array.isArray(lineIds) ? lineIds : [lineIds];
    return enqueue(async () => commit(await removeLines(ids), 'remove'));
  },

  /** @returns {Promise<ShopifyCart | null>} */
  clear() {
    const ids = currentLines().map((line) => line.id);
    if (!ids.length) return Promise.resolve(currentCart());
    return Cart.removeLine(ids);
  },

  /**
   * @param {string | null | undefined} note
   * @returns {Promise<ShopifyCart | null>}
   */
  setNote(note) {
    const variables = { note: note ?? '' };
    return enqueue(async () =>
      commit(
        await mutateCart({
          name: 'cartNoteUpdate',
          args: '$note: String!',
          inner: 'note: $note',
          variables,
          createInput: variables,
        }),
        'note',
      ),
    );
  },

  /**
   * Cart attributes, merged with the cart's (as it is when the change runs, so quick calls don't drop each other).
   *
   * @param {Attributes} attributes The value `''` removes a key.
   * @returns {Promise<ShopifyCart | null>}
   */
  setAttributes(attributes) {
    return enqueue(async () => {
      const variables = { attributes: mergedAttributes(attributes) };
      const cart = await mutateCart({
        name: 'cartAttributesUpdate',
        args: '$attributes: [AttributeInput!]!',
        inner: 'attributes: $attributes',
        variables,
        createInput: variables,
      });
      return commit(cart, 'attributes');
    });
  },

  /**
   * Replaces the discount codes; `[]` removes them all.
   *
   * @param {string[] | string | ((current: string[]) => string[])} codes
   * @returns {Promise<ShopifyCart | null>}
   */
  setDiscountCodes(codes) {
    return enqueue(async () => {
      const variables = { discountCodes: discountCodesFrom(codes) };
      const cart = await mutateCart({
        name: 'cartDiscountCodesUpdate',
        args: '$discountCodes: [String!]!',
        inner: 'discountCodes: $discountCodes',
        variables,
        createInput: variables,
      });
      return commit(cart, 'discount');
    });
  },

  /**
   * Adds a code. A code Shopify doesn't accept is removed again, so it doesn't warn on every later change.
   *
   * @param {string} code
   * @returns {Promise<ShopifyCart | null>}
   * @throws {TetherError} `INVALID_DISCOUNT` (rejected) when Shopify doesn't accept the code.
   */
  async applyDiscount(code) {
    const cart = await Cart.setDiscountCodes((current) => [...new Set([...current, code])]);
    const wanted = code.toLowerCase();
    const applied = (cart?.discountCodes ?? []).find((discount) => discount.code.toLowerCase() === wanted);
    if (applied?.applicable) return cart;
    try {
      await Cart.removeDiscount(code);
    } catch (error) {
      reportError(error, 'removing a discount code Shopify refused');
    }
    throw new TetherError(`Discount code not valid: ${code}`, { code: 'INVALID_DISCOUNT' });
  },

  /**
   * @param {string} code
   * @returns {Promise<ShopifyCart | null>}
   */
  removeDiscount(code) {
    const unwanted = code.toLowerCase();
    return Cart.setDiscountCodes((current) => current.filter((existing) => existing.toLowerCase() !== unwanted));
  },

  /**
   * Sets who is buying; a country changes the cart's currency and prices to that market's.
   *
   * @param {{ countryCode?: string, email?: string, phone?: string, customerAccessToken?: string | null }} buyerIdentity
   * @param {{ create?: boolean }} [options] `create: false` forgets an expired cart instead of creating an empty one.
   * @returns {Promise<ShopifyCart | null>}
   */
  setBuyerIdentity(buyerIdentity, { create = true } = {}) {
    return enqueue(async () => {
      const cart = await mutateCart({
        name: 'cartBuyerIdentityUpdate',
        args: '$buyerIdentity: CartBuyerIdentityInput!',
        inner: 'buyerIdentity: $buyerIdentity',
        variables: { buyerIdentity },
        createInput: create ? { buyerIdentity } : null,
      }).catch((/** @type {unknown} */ error) => {
        // mutateCart has forgotten the cart Shopify no longer has; without `create` that leaves no cart.
        if (create || !isCartGone(error)) throw error;
        return null;
      });
      return commit(cart, 'buyer-identity');
    });
  },

  checkout,

  drawers,
  isOpen,
  open: openCart,
  close: closeCart,
  toggle: toggleCart,
};
