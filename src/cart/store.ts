/**
 * The cart on this page: what Shopify last said about it (`CartStatus`), the quantities quick clicks asked for and
 * the one queue every change goes through. A change of what the page shows goes through
 * here, so the document (`renderCart`) and the listeners (`tether:cart-updated`) always see the store's cart.
 */
import { cfg } from '../config.ts';
import { emit } from '../dom.ts';
import { isOpen } from './drawer.ts';
import { renderCart, quantityOf, showSavedCount } from './render.ts';
import { getStored, removeStored, setStored } from '../storage.ts';
import { CART_ID } from '../../server/src/shared/cart-id.ts';
import type { CartWarning } from '../config.ts';
import type { Image } from '../fragments.ts';
import type { Money } from '../shopify-values.ts';

export interface Attribute {
  key: string;
  value: string;
}

/** A line's `merchandise`: Shopify's `Merchandise` union has only `ProductVariant`. */
export interface CartVariant {
  id: string;
  title: string;
  sku: string | null;
  availableForSale: boolean;
  requiresShipping: boolean;
  /** Absent when the store's token can't read inventory. */
  quantityAvailable?: number | null;
  image: Image | null;
  price: Money;
  compareAtPrice: Money | null;
  selectedOptions: { name: string; value: string }[];
  product: { id: string; title: string; handle: string; vendor: string; featuredImage: Image | null };
}

interface LinePlanAllocation {
  sellingPlan: {
    id: string;
    name: string;
    description: string | null;
    recurringDeliveries: boolean;
    options: { name: string; value: string }[];
  };
  checkoutChargeAmount: Money;
  priceAdjustments: { price: Money; compareAtPrice: Money; perDeliveryPrice: Money }[];
}

export interface ShopifyCartLine {
  id: string;
  quantity: number;
  attributes: Attribute[];
  cost: {
    totalAmount: Money;
    subtotalAmount: Money;
    amountPerQuantity: Money;
    compareAtAmountPerQuantity: Money | null;
  };
  discountAllocations: { discountedAmount: Money }[];
  sellingPlanAllocation: LinePlanAllocation | null;
  merchandise: CartVariant;
  /** Only on a bundle (`ComponentizableCartLine`). */
  lineComponents?: {
    id: string;
    quantity: number;
    merchandise: { id: string; title: string; product: { title: string; handle: string } };
  }[];
}

/** The fields of `fragment TetherCart`. */
export interface ShopifyCart {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  attributes: Attribute[];
  buyerIdentity: { countryCode: string | null; email: string | null };
  discountCodes: { code: string; applicable: boolean }[];
  cost: { subtotalAmount: Money; totalAmount: Money; checkoutChargeAmount: Money };
  lines: { nodes: ShopifyCartLine[] };
}

/**
 * `unknown` until the saved cart has loaded (the page's own markup shows); `empty` without a cart (none saved, or
 * Shopify no longer has it); `error` after a failed load or change, with the cart as Shopify last sent it.
 */
export type CartStatus =
  | { kind: 'unknown' }
  | { kind: 'empty' }
  | { kind: 'ready'; cart: ShopifyCart }
  | { kind: 'error'; error: unknown; cart: ShopifyCart | null };

/** What one quick +/- click asked for; a newer click replaces it. */
export interface PendingQuantity {
  quantity: number;
}

/** The second argument of a `subscribe` listener. */
interface CartMeta {
  open: boolean;
  count: number;
  loaded: boolean;
  /** A copy of Shopify's notes on the last change. */
  warnings: CartWarning[];
}

let status: CartStatus = { kind: 'unknown' };

/** Shopify's notes on the last change. */
let warnings: readonly CartWarning[] = [];

/** Line id → what quick +/- clicks asked for, until Shopify has answered. */
export const pendingQuantities = new Map<string, PendingQuantity>();

export const cartStatus = (): CartStatus => status;

/** The cart as Shopify last sent it. */
export function currentCart(): ShopifyCart | null {
  switch (status.kind) {
    case 'ready':
    case 'error':
      return status.cart;
    case 'unknown':
    case 'empty':
      return null;
  }
}

export const currentWarnings = (): readonly CartWarning[] => warnings;

const statusOf = (cart: ShopifyCart | null): CartStatus => (cart ? { kind: 'ready', cart } : { kind: 'empty' });

const seenKey = () => `${cfg.storageKey}:seen`;

/**
 * The id of the visitor's cart, kept across pages. A stored value that isn't a cart id (written by another script,
 * or edited by hand) is forgotten, so it is never sent to Shopify or the Worker and the next change starts a new cart.
 */
export function savedCartId(): string | null {
  const stored = getStored(cfg.storageKey);
  if (!stored) return null;
  if (CART_ID.test(stored)) return stored;
  forgetSavedCart();
  return null;
}

/** Forgets the saved cart, which Shopify no longer has. */
export function forgetSavedCart(): void {
  removeStored(cfg.storageKey);
}

/** Keeps a cart Shopify sent without showing it, for an answer a newer change will replace. */
export function keepQuietly(cart: ShopifyCart | null): void {
  status = statusOf(cart);
  if (cart) setStored(cfg.storageKey, cart.id);
}

/** Renders the document with the store's cart. */
export function render(): void {
  renderCart({
    cart: currentCart(),
    warnings,
    pending: pendingQuantities,
    failed: status.kind === 'error',
  });
}

/**
 * Why `tether:cart-updated` fired: `load` when the saved cart was loaded, failed to load or was forgotten; `pending`
 * when quick clicks changed a quantity Shopify doesn't have yet, and `settled` once their last request is done; any
 * other value names the change Shopify just answered. `docs/reference.md` lists them.
 */
export type CartUpdateReason =
  'load' | 'add' | 'update' | 'remove' | 'note' | 'attributes' | 'discount' | 'buyer-identity' | 'pending' | 'settled';

/** @param reason The `reason` of `tether:cart-updated`. */
export function announce(reason: CartUpdateReason): void {
  render();
  emit('cart-updated', { cart: currentCart(), reason });
}

/**
 * Keeps a cart Shopify sent after a change, shows it, and tells this page and the visitor's other tabs.
 *
 * @returns `cart`.
 */
export function commit(cart: ShopifyCart | null, reason: CartUpdateReason): ShopifyCart | null {
  keepQuietly(cart);
  // Other tabs reload the cart on this storage event; the next page shows the count before its cart has loaded.
  setStored(seenKey(), `${Date.now()}|${cart?.totalQuantity ?? 0}`);
  announce(reason);
  return cart;
}

/** The outcome of loading the saved cart: the cart, `null` when there is none, or the failure. */
export function settleLoad(
  outcome: { kind: 'loaded'; cart: ShopifyCart | null } | { kind: 'failed'; error: unknown },
): void {
  status = outcome.kind === 'loaded' ? statusOf(outcome.cart) : { kind: 'error', error: outcome.error, cart: null };
  announce('load');
}

/**
 * The cart's count on the last page, from `<storageKey>:seen` (`<time>|<count>`).
 *
 * @returns `null` unless the count is a whole number: other scripts and other Tether versions write storage too.
 */
function lastKnownCount(): number | null {
  const text = getStored(seenKey())?.split('|')[1] ?? '';
  const count = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(count) ? count : null;
}

/** Until the saved cart has loaded, the counts show the count it had on the last page instead of the page's 0. */
export function showLastKnownCount(): void {
  if (status.kind !== 'unknown') return;
  const count = lastKnownCount();
  if (count !== null) showSavedCount(count);
}

/** Sets Shopify's notes on the last change: each message once, in the site's words (`warningText`). */
export function setWarnings(notes: readonly CartWarning[]): void {
  warnings = notes
    .filter((note, index) => notes.findIndex((other) => other.message === note.message) === index)
    .map((note) => ({ ...note, message: cfg.warningText?.(note) || note.message }));
  if (warnings.length) emit('cart-warning', { warnings });
}

/** The queue only waits for a task: its result, or failure, reaches the caller through the promise `run` returns. */
const waitOnly = () => undefined;

/** @returns A runner that starts each task once the one before has settled, whether it succeeded or failed. */
export function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let previous: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = previous.then(task);
    previous = run.then(waitOnly, waitOnly);
    return run;
  };
}

/** The one queue every cart change runs through; the checkout's URL lookup waits in it too. */
export const runInOrder = serial();

/**
 * Runs a cart change after the ones before it, so quick clicks never race. A failure sets the `error` status (shown by
 * `tether-show="cart-error"` until the next change succeeds), emits `tether:cart-error` and rejects.
 */
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return runInOrder(task).then(
    (value) => {
      if (status.kind === 'error') {
        status = statusOf(status.cart);
        render();
      }
      return value;
    },
    (error: unknown) => {
      status = { kind: 'error', error, cart: currentCart() };
      render();
      emit('cart-error', { error });
      throw error;
    },
  );
}

/** @returns The quantity to show for `line`. */
export const pendingQuantityOf = (line: ShopifyCartLine): number => quantityOf(line, pendingQuantities);

const meta = (): CartMeta => ({
  open: isOpen(),
  count: currentCart()?.totalQuantity ?? 0,
  loaded: status.kind !== 'unknown',
  warnings: [...warnings],
});

/**
 * Calls `listener` now and after every change of the cart or the drawer.
 *
 * @returns Stops listening.
 */
export function subscribe(listener: (cart: ShopifyCart | null, meta: CartMeta) => void): () => void {
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
