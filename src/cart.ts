/**
 * The cart, as one object: `Tether.cart`. Every change goes through one queue (fast clicks never race) and resolves
 * with the cart Shopify sent back. The state lives in `cart/store.ts`, the Cart API calls in `cart/mutations.ts`, the
 * drawer in `cart/drawer.ts`, the document rendering in `cart/render.ts` and the checkout in `cart/checkout.ts`.
 */
import { cfg, reportError } from './config.ts';
import { TetherError } from './client.ts';
import { emit, toAttributes } from './dom.ts';
import {
  fetchCart,
  isCartGone,
  isUnclearFailure,
  mutateCart,
  removeLines,
  setLineQuantity,
  toLineInput,
  toLineUpdate,
  updateLines,
} from './cart/mutations.ts';
import { checkout, setCheckoutResolver } from './cart/checkout.ts';
import { drawers, isOpen, openCart, closeCart, toggleCart, trapFocus } from './cart/drawer.ts';
import {
  announce,
  cartStatus,
  commit,
  currentCart,
  currentWarnings,
  enqueue,
  forgetSavedCart,
  keepQuietly,
  pendingQuantities,
  pendingQuantityOf,
  render,
  savedCartId,
  settleLoad,
  showLastKnownCount,
  subscribe,
} from './cart/store.ts';
import type { CartWarning } from './config.ts';
import type { Attributes, LineSpec, CartLineInput, LinePatch } from './cart/mutations.ts';
import type { ShopifyCart, ShopifyCartLine, CartStatus } from './cart/store.ts';

export { trapFocus };

type DiscountCodes = string[] | string | ((current: string[]) => string[]);

const currentLines = (): readonly ShopifyCartLine[] => currentCart()?.lines.nodes ?? [];

/**
 * Loads the saved cart again after a change whose outcome is unclear, so this page and the visitor's other tabs show
 * what Shopify has. A failure here is reported; the change's own failure is what its caller hears.
 */
async function reloadAfterUnclearFailure(): Promise<void> {
  const id = savedCartId();
  if (!id) return;
  try {
    const cart = await fetchCart(id);
    if (!cart) forgetSavedCart();
    commit(cart, 'load');
  } catch (error) {
    reportError(error, 'cart reload after a failed change');
  }
}

/**
 * Runs a cart change in the queue (`enqueue`). After a failure that doesn't say whether Shopify applied the change,
 * the cart is loaded again before the next change runs; the change still rejects.
 */
function runChange<T>(task: () => Promise<T>): Promise<T> {
  return enqueue(() =>
    task().catch(async (error: unknown) => {
      if (isUnclearFailure(error)) await reloadAfterUnclearFailure();
      throw error;
    }),
  );
}

/**
 * +1 / -1 for a line. Quick clicks add up: each builds on the quantity the click before asked for, which shows at once
 * (`tether-line="quantity"`, `quantityOf`) until Shopify has answered. Only the latest target is sent; the ones it
 * replaced are skipped.
 */
function changeQuantity(lineId: string, delta: number): Promise<ShopifyCart | null> {
  const line = currentLines().find((candidate) => candidate.id === lineId);
  if (!line) return Promise.resolve(currentCart());
  const target = Math.max(0, pendingQuantityOf(line) + delta);
  const job = { quantity: target };
  pendingQuantities.set(lineId, job);
  announce('pending');
  const isLatest = () => pendingQuantities.get(lineId) === job;
  const sent = runChange(async () => {
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
 * @param codes A function gets the codes as they are by then.
 */
function discountCodesFrom(codes: DiscountCodes): string[] {
  const current = (currentCart()?.discountCodes ?? []).map((discount) => discount.code);
  const list = typeof codes === 'function' ? codes(current) : codes;
  return (Array.isArray(list) ? list : [list]).map((code) => code.trim()).filter(Boolean);
}

/** @returns The cart's attributes with `attributes` merged in; `''` removes a key. */
function mergedAttributes(attributes: Attributes): { key: string; value: string }[] {
  const merged = new Map((currentCart()?.attributes ?? []).map((attribute) => [attribute.key, attribute.value]));
  toAttributes(attributes).forEach((attribute) => merged.set(attribute.key, attribute.value));
  return [...merged].filter(([, value]) => value !== '').map(([key, value]) => ({ key, value }));
}

/**
 * Loads the saved cart. A cart Shopify no longer has is forgotten; one it can't be asked about (the network, the
 * token) is kept, because it is probably fine.
 */
async function init(): Promise<ShopifyCart | null> {
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
  /** The saved cart's id. */
  id: savedCartId,

  get status(): CartStatus {
    return cartStatus();
  },
  get state(): ShopifyCart | null {
    return currentCart();
  },
  /** The cart's lines, a copy: changing it changes nothing in the cart. */
  get lines(): ShopifyCartLine[] {
    return [...currentLines()];
  },
  get count(): number {
    return currentCart()?.totalQuantity ?? 0;
  },
  /** True once the saved cart, or that there is none, is known. */
  get loaded(): boolean {
    return cartStatus().kind !== 'unknown';
  },
  /**
   * The failure of the last load or change, until a change succeeds. Requests fail with an `Error`; anything else
   * thrown is wrapped, so the public type holds.
   */
  get lastError(): Error | null {
    const current = cartStatus();
    if (current.kind !== 'error') return null;
    return current.error instanceof Error ? current.error : new Error(String(current.error));
  },
  /** Shopify's notes on the last change, a copy. */
  get warnings(): CartWarning[] {
    return [...currentWarnings()];
  },
  /** Line id → the quantity quick clicks asked for. */
  get pendingQty(): ReadonlyMap<string, { quantity: number }> {
    return pendingQuantities;
  },

  /**
   * Sets where a logged-in customer checks out, or clears it with `null`: the account part's resolver answers the
   * customer's checkout URL for the cart (`null` uses the cart's own).
   */
  setCheckoutResolver,

  /**
   * Forgets the saved cart on this device, as if there were none: the page shows an empty cart and
   * `tether:cart-updated` fires with reason `load`. The next add starts a new cart.
   */
  forgetSaved(): void {
    forgetSavedCart();
    settleLoad({ kind: 'loaded', cart: null });
  },

  render,
  subscribe,

  /**
   * `add(variantId, 2)`, `add({ variantId, quantity, sellingPlanId, attributes })`, or `add([line, line])` for
   * bundles in one request. Creates the cart when there is none.
   *
   * @throws {TetherError} (rejected) When the add fails, or Shopify answers it without a cart.
   */
  add(
    input: string | number | LineSpec | (string | number | LineSpec)[],
    quantity = 1,
    options: Omit<LineSpec, 'variantId' | 'quantity'> = {},
  ): Promise<ShopifyCart> {
    const lines: CartLineInput[] = (Array.isArray(input) ? input : [input]).map((line) =>
      toLineInput(line, quantity, options),
    );
    return runChange(async () => {
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
   * @param patch A quantity of 0 or less removes the line.
   */
  updateLine(lineId: string, patch: number | LinePatch): Promise<ShopifyCart | null> {
    const quantity = typeof patch === 'number' ? patch : patch.quantity;
    if (quantity !== undefined && quantity <= 0) return Cart.removeLine(lineId);
    const line = toLineUpdate(lineId, patch);
    return runChange(async () => commit(await updateLines([line]), 'update'));
  },

  changeQuantity,

  /** The quantity to show: the one asked for while an update is on its way. */
  quantityOf: pendingQuantityOf,

  removeLine(lineIds: string | string[]): Promise<ShopifyCart | null> {
    const ids = Array.isArray(lineIds) ? lineIds : [lineIds];
    return runChange(async () => commit(await removeLines(ids), 'remove'));
  },

  /** Removes the lines the cart has when the change runs, so one queued just before it is cleared too. */
  clear(): Promise<ShopifyCart | null> {
    return runChange(async () => {
      const ids = currentLines().map((line) => line.id);
      if (!ids.length) return currentCart();
      return commit(await removeLines(ids), 'remove');
    });
  },

  setNote(note: string | null | undefined): Promise<ShopifyCart | null> {
    const variables = { note: note ?? '' };
    return runChange(async () =>
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
   * @param attributes The value `''` removes a key.
   */
  setAttributes(attributes: Attributes): Promise<ShopifyCart | null> {
    return runChange(async () => {
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

  /** Replaces the discount codes; `[]` removes them all. */
  setDiscountCodes(codes: DiscountCodes): Promise<ShopifyCart | null> {
    return runChange(async () => {
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
   * @throws {TetherError} `INVALID_DISCOUNT` (rejected) when Shopify doesn't accept the code, or it is blank.
   */
  async applyDiscount(typed: string): Promise<ShopifyCart | null> {
    // Shopify is sent the code trimmed (`discountCodesFrom`), so it is looked up and removed trimmed too.
    const code = typed.trim();
    // Shopify has no blank code; asking it would cost two mutations, and a cart for a visitor who had none.
    if (!code) throw new TetherError('No discount code', { code: 'INVALID_DISCOUNT' });
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

  removeDiscount(code: string): Promise<ShopifyCart | null> {
    const unwanted = code.trim().toLowerCase();
    return Cart.setDiscountCodes((current) => current.filter((existing) => existing.toLowerCase() !== unwanted));
  },

  /**
   * Sets who is buying; a country changes the cart's currency and prices to that market's.
   *
   * @param options `create: false` forgets an expired cart instead of creating an empty one.
   */
  setBuyerIdentity(
    buyerIdentity: { countryCode?: string; email?: string; phone?: string },
    { create = true }: { create?: boolean } = {},
  ): Promise<ShopifyCart | null> {
    return runChange(async () => {
      const cart = await mutateCart({
        name: 'cartBuyerIdentityUpdate',
        args: '$buyerIdentity: CartBuyerIdentityInput!',
        inner: 'buyerIdentity: $buyerIdentity',
        variables: { buyerIdentity },
        createInput: create ? { buyerIdentity } : null,
      }).catch((error: unknown) => {
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
