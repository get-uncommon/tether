/**
 * The Storefront Cart API: loading the saved cart, creating one, and the mutations that change it. Shopify forgets a
 * cart some days after its last change and once it has been checked out; a change that needs a cart then creates a
 * new one with the same input, so the visitor's click still lands.
 */
import { cfg, log } from '../config.ts';
import { gql, orNull, shaped, unwrap, TetherError } from '../client.ts';
import { cartFragment } from '../fragments.ts';
import { GID } from '../selling-plans.ts';
import { toAttributes } from '../dom.ts';
import { CART } from './cart-shape.ts';
import { savedCartId, forgetSavedCart, setWarnings } from './store.ts';
import type { CartWarning } from '../config.ts';
import type { QueryText, UserError } from '../client.ts';
import type { AttributeValue } from '../dom.ts';
import type { ShopifyCart, Attribute } from './store.ts';

export type Attributes = Record<string, AttributeValue> | { key: string | number; value?: AttributeValue }[];

/** A line to add, in any of the shapes `Cart.add` takes. */
export interface LineSpec {
  variantId?: string | number;
  merchandiseId?: string | number;
  id?: string | number;
  quantity?: number | string;
  sellingPlanId?: string | number | null;
  sellingPlan?: string | number | null;
  attributes?: Attributes | null;
}

/** Shopify's `CartLineInput`. */
export interface CartLineInput {
  merchandiseId: string;
  quantity: number;
  sellingPlanId?: string;
  attributes?: Attribute[];
}

/** What every cart mutation answers. Its lists are read with a fallback, so `isPayloadOf` checks the cart alone. */
interface CartPayload {
  cart: ShopifyCart | null;
  userErrors?: UserError[] | null;
  warnings?: CartWarning[];
}

/**
 * Shopify answers a cart id it can't resolve, in a mutation, with a top-level GraphQL error whose only detail is
 * this message (no `extensions.code`). A user error on the `cartId` field is recognised by its shape instead.
 */
const UNKNOWN_CART_MESSAGE = /does not exist|not found|invalid id/i;

/** @returns A check of a mutation's answer: a `null` payload (which `unwrap` refuses), or one with a cart or `null`. */
const isPayloadOf = (name: string) =>
  shaped<Record<string, CartPayload | null>>({ [name]: orNull({ cart: orNull(CART) }) });

/**
 * @returns True when `error` says Shopify doesn't have the cart, false for any other failure (the network, the token,
 *   a line it refused), after which the saved cart is still good.
 */
export function isCartGone(error: unknown): boolean {
  if (!(error instanceof TetherError)) return false;
  if (error.userErrors?.some((userError) => userError.field?.[0] === 'cartId')) return true;
  return (error.errors ?? []).some((graphQLError) => UNKNOWN_CART_MESSAGE.test(graphQLError.message));
}

/**
 * @returns True when a change failed without saying whether Shopify applied it: no answer or no whole body came (the
 *   network), a 2xx whose body isn't valid, or a server error (a 5xx, or a 2xx with `SERVER_ERROR`), which can come
 *   after the change was committed. Shopify's user errors and a 4xx are clear.
 */
export function isUnclearFailure(error: unknown): boolean {
  if (!(error instanceof TetherError)) return false;
  const { code, status = 0 } = error;
  return code === 'NETWORK' || code === 'INVALID_RESPONSE' || code === 'SERVER_ERROR' || status >= 500;
}

/**
 * @param input A variant id, or a line.
 * @param quantity For a variant id.
 * @param options For a variant id.
 * @throws {TetherError} `ERROR` without a variant id.
 */
export function toLineInput(
  input: string | number | LineSpec | null | undefined,
  quantity = 1,
  options: Omit<LineSpec, 'variantId' | 'quantity'> = {},
): CartLineInput {
  const spec: LineSpec =
    typeof input === 'object' && input !== null
      ? input
      : { ...options, quantity, ...(input === null || input === undefined ? {} : { variantId: input }) };
  const merchandiseId = GID.variant(spec.merchandiseId || spec.variantId || spec.id);
  if (!merchandiseId) throw new TetherError('add(): variantId is required');
  const asked = parseInt(String(spec.quantity ?? 1), 10);
  const line: CartLineInput = { merchandiseId, quantity: Math.max(1, asked || 1) };
  const planId = GID.sellingPlan(spec.sellingPlanId || spec.sellingPlan);
  if (planId) line.sellingPlanId = planId;
  const attributes = toAttributes(spec.attributes);
  if (attributes.length) line.attributes = attributes;
  return line;
}

/**
 * @param name The mutation, which is also its payload's field.
 * @param args The operation's variable definitions.
 * @param inner The mutation field's arguments.
 */
function mutationText(name: string, args: string, inner: string): QueryText {
  return (access) => `mutation Tether_${name}(${args}) {
  ${name}(${inner}) { cart { ...TetherCart } userErrors { field message } warnings { code message target } }
}
${cartFragment(access)}`;
}

/**
 * @returns The cart in Shopify's answer, after keeping its warnings.
 * @throws {TetherError} For a failed request, or the mutation's user errors.
 */
async function send(
  name: string,
  args: string,
  inner: string,
  variables: Record<string, unknown>,
): Promise<ShopifyCart | null> {
  const data = await gql(mutationText(name, args, inner), variables, isPayloadOf(name), { operation: 'mutation' });
  const payload = unwrap(data[name], name);
  setWarnings(payload.warnings ?? []);
  return payload.cart;
}

/**
 * A new cart in the visitor's market.
 *
 * @param input More of Shopify's `CartInput`, e.g. the first lines.
 */
function createCart(input: Record<string, unknown>): Promise<ShopifyCart | null> {
  const withIdentity = cfg.country ? { buyerIdentity: { countryCode: cfg.country }, ...input } : input;
  return send('cartCreate', '$input: CartInput!', 'input: $input', { input: withIdentity });
}

/** A mutation on the saved cart, with one variable besides `$cartId`. */
interface CartMutation {
  /** The mutation, e.g. `cartLinesAdd`. */
  name: string;
  /** The variable, named like the mutation's argument and like the `CartInput` field `create` sets. */
  variable: string;
  /** The variable's GraphQL type. */
  type: string;
  value: unknown;
  /**
   * Whether, when there is no cart (or Shopify no longer has it), a new cart is made with the value, which does what
   * the mutation asks; without it the visitor is left without a cart.
   */
  create: boolean;
}

/**
 * Runs a mutation on the saved cart, or creates a cart with its value (`create`) when there is none to change.
 *
 * @returns The changed cart; `null` without a cart and without `create`.
 * @throws {TetherError} For a failed request or Shopify's user errors; also when the cart is gone and there is no
 *   `create` (the saved cart is forgotten first).
 */
export async function mutateCart({ name, variable, type, value, create }: CartMutation): Promise<ShopifyCart | null> {
  const createInput = create ? { [variable]: value } : null;
  const cartId = savedCartId();
  if (!cartId) return createInput ? createCart(createInput) : null;
  try {
    return await send(name, `$cartId: ID!, $${variable}: ${type}`, `cartId: $cartId, ${variable}: $${variable}`, {
      [variable]: value,
      cartId,
    });
  } catch (error) {
    if (!isCartGone(error)) throw error;
    forgetSavedCart();
    if (!createInput) throw error;
    log('cart expired, creating a new one');
    return createCart(createInput);
  }
}

/** @returns The cart, `null` when Shopify doesn't have it (expired or checked out). */
export async function fetchCart(id: string): Promise<ShopifyCart | null> {
  const data = await gql(
    (access) => `query TetherCart($id: ID!) { cart(id: $id) { ...TetherCart } }\n${cartFragment(access)}`,
    { id },
    shaped<{ cart: ShopifyCart | null }>({ cart: orNull(CART) }),
  );
  return data.cart;
}

/** @returns The cart's current checkout URL, `null` when Shopify doesn't have the cart. */
export async function fetchCheckoutUrl(id: string): Promise<string | null> {
  const data = await gql(
    `query TetherCheckout($id: ID!) { cart(id: $id) { checkoutUrl } }`,
    { id },
    shaped<{ cart: { checkoutUrl: string } | null }>({ cart: orNull({ checkoutUrl: 'string' }) }),
  );
  return data.cart?.checkoutUrl ?? null;
}

/** A change to one line, for `updateLine`. */
export interface LinePatch {
  /** 0 or less removes the line. */
  quantity?: number;
  /** `null` switches the line back to one-time purchase. */
  sellingPlanId?: string | number | null;
  attributes?: Attributes;
  merchandiseId?: string | number;
  variantId?: string | number;
}

/** @returns Shopify's `CartLineUpdateInput`. */
export function toLineUpdate(lineId: string, patch: number | LinePatch): Record<string, unknown> {
  const change: LinePatch = typeof patch === 'number' ? { quantity: patch } : patch;
  const line: Record<string, unknown> = { id: lineId };
  if (change.quantity !== undefined) line['quantity'] = change.quantity;
  if ('sellingPlanId' in change)
    line['sellingPlanId'] = change.sellingPlanId ? GID.sellingPlan(change.sellingPlanId) : null;
  if (change.attributes) line['attributes'] = toAttributes(change.attributes);
  const variantId = change.merchandiseId || change.variantId;
  if (variantId) line['merchandiseId'] = GID.variant(variantId);
  return line;
}

export const updateLines = (lines: Record<string, unknown>[]): Promise<ShopifyCart | null> =>
  mutateCart({
    name: 'cartLinesUpdate',
    variable: 'lines',
    type: '[CartLineUpdateInput!]!',
    value: lines,
    create: false,
  });

export const removeLines = (lineIds: string[]): Promise<ShopifyCart | null> =>
  mutateCart({
    name: 'cartLinesRemove',
    variable: 'lineIds',
    type: '[ID!]!',
    value: lineIds,
    create: false,
  });

/** @returns The cart once `lineId` has `target` (0 removes it). */
export const setLineQuantity = (lineId: string, target: number): Promise<ShopifyCart | null> =>
  target > 0 ? updateLines([{ id: lineId, quantity: target }]) : removeLines([lineId]);
