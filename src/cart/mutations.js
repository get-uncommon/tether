/**
 * The Storefront Cart API: loading the saved cart, creating one, and the mutations that change it. Shopify forgets a
 * cart some days after its last change and once it has been checked out; a change that needs a cart then creates a
 * new one with the same input, so the visitor's click still lands.
 */
import { cfg, log } from '../config.js';
import { gql, unwrap, TetherError } from '../client.js';
import { cartFragment } from '../fragments.js';
import { GID } from '../selling-plans.js';
import { toAttributes } from '../dom.js';
import { savedCartId, forgetSavedCart, setWarnings } from './store.js';
/** @import { CartWarning } from '../config.js' */
/** @import { QueryText, UserError } from '../client.js' */
/** @import { AttributeValue } from '../dom.js' */
/** @import { ShopifyCart, Attribute } from './store.js' */

/** @typedef {Record<string, AttributeValue> | { key: string | number, value?: AttributeValue }[]} Attributes */
/**
 * @typedef {object} LineSpec A line to add, in any of the shapes `Cart.add` takes.
 * @property {string | number} [variantId]
 * @property {string | number} [merchandiseId]
 * @property {string | number} [id]
 * @property {number | string} [quantity]
 * @property {string | number | null} [sellingPlanId]
 * @property {string | number | null} [sellingPlan]
 * @property {Attributes | null} [attributes]
 */
/**
 * @typedef {object} CartLineInput Shopify's `CartLineInput`.
 * @property {string} merchandiseId
 * @property {number} quantity
 * @property {string} [sellingPlanId]
 * @property {Attribute[]} [attributes]
 */
/**
 * @typedef {object} CartPayload What every cart mutation answers.
 * @property {ShopifyCart | null} cart
 * @property {UserError[]} userErrors
 * @property {CartWarning[]} [warnings]
 */

/**
 * Shopify answers a cart id it can't resolve, in a mutation, with a top-level GraphQL error whose only detail is
 * this message (no `extensions.code`). A user error on the `cartId` field is recognised by its shape instead.
 */
const UNKNOWN_CART_MESSAGE = /does not exist|not found|invalid id/i;

/**
 * @param {unknown} error
 * @returns {boolean} True when `error` says Shopify doesn't have the cart, false for any other failure (the network,
 *   the token, a line it refused), after which the saved cart is still good.
 */
export function isCartGone(error) {
  if (!(error instanceof TetherError)) return false;
  if (error.userErrors?.some((userError) => userError.field?.[0] === 'cartId')) return true;
  return (error.errors ?? []).some((graphQLError) => UNKNOWN_CART_MESSAGE.test(graphQLError.message));
}

/**
 * @param {string | number | LineSpec | null | undefined} input A variant id, or a line.
 * @param {number} [quantity] For a variant id.
 * @param {Omit<LineSpec, 'variantId' | 'quantity'>} [options] For a variant id.
 * @returns {CartLineInput}
 * @throws {TetherError} `ERROR` without a variant id.
 */
export function toLineInput(input, quantity = 1, options = {}) {
  const spec = typeof input === 'object' && input !== null ? input : { ...options, variantId: input, quantity };
  const merchandiseId = GID.variant(spec.merchandiseId || spec.variantId || spec.id);
  if (!merchandiseId) throw new TetherError('add(): variantId is required');
  const asked = parseInt(String(spec.quantity ?? 1), 10);
  /** @type {CartLineInput} */
  const line = { merchandiseId, quantity: Math.max(1, asked || 1) };
  const planId = GID.sellingPlan(spec.sellingPlanId || spec.sellingPlan);
  if (planId) line.sellingPlanId = planId;
  const attributes = toAttributes(spec.attributes);
  if (attributes.length) line.attributes = attributes;
  return line;
}

/**
 * @param {string} name The mutation, which is also its payload's field.
 * @param {string} args The operation's variable definitions.
 * @param {string} inner The mutation field's arguments.
 * @returns {QueryText}
 */
function mutationText(name, args, inner) {
  return (access) => `mutation Tether_${name}(${args}) {
  ${name}(${inner}) { cart { ...TetherCart } userErrors { field message } warnings { code message target } }
}
${cartFragment(access)}`;
}

/**
 * @param {string} name
 * @param {string} args
 * @param {string} inner
 * @param {Record<string, unknown>} variables
 * @returns {Promise<ShopifyCart | null>} The cart in Shopify's answer, after keeping its warnings.
 * @throws {TetherError} For a failed request, or the mutation's user errors.
 */
async function send(name, args, inner, variables) {
  /** @type {Record<string, CartPayload | null | undefined>} */
  const data = await gql(mutationText(name, args, inner), variables);
  const payload = unwrap(data[name], name);
  setWarnings(payload.warnings ?? []);
  return payload.cart;
}

/**
 * A new cart in the visitor's market.
 *
 * @param {Record<string, unknown>} input More of Shopify's `CartInput`, e.g. the first lines.
 * @returns {Promise<ShopifyCart | null>}
 */
function createCart(input) {
  const withIdentity = cfg.country ? { buyerIdentity: { countryCode: cfg.country }, ...input } : input;
  return send('cartCreate', '$input: CartInput!', 'input: $input', { input: withIdentity });
}

/**
 * @typedef {object} CartMutation A mutation on the saved cart.
 * @property {string} name The mutation, e.g. `cartLinesAdd`.
 * @property {string} args Its variable definitions besides `$cartId`.
 * @property {string} inner Its arguments besides `cartId`.
 * @property {Record<string, unknown>} variables
 * @property {Record<string, unknown> | null} createInput The `CartInput` of a new cart that does what the mutation
 *   asks, when there is no cart (or Shopify no longer has it); `null` leaves the visitor without a cart instead.
 */

/**
 * Runs a mutation on the saved cart, or creates a cart from `createInput` when there is none to change.
 *
 * @param {CartMutation} mutation
 * @returns {Promise<ShopifyCart | null>} The changed cart; `null` without a cart and without a `createInput`.
 * @throws {TetherError} For a failed request or Shopify's user errors; also when the cart is gone and there is no
 *   `createInput` (the saved cart is forgotten first).
 */
export async function mutateCart({ name, args, inner, variables, createInput }) {
  const cartId = savedCartId();
  if (!cartId) return createInput ? createCart(createInput) : null;
  try {
    return await send(name, `$cartId: ID!, ${args}`, `cartId: $cartId, ${inner}`, { ...variables, cartId });
  } catch (error) {
    if (!isCartGone(error)) throw error;
    forgetSavedCart();
    if (!createInput) throw error;
    log('cart expired, creating a new one');
    return createCart(createInput);
  }
}

/**
 * @param {string} id
 * @returns {Promise<ShopifyCart | null>} The cart, `null` when Shopify doesn't have it (expired or checked out).
 */
export async function fetchCart(id) {
  /** @type {{ cart: ShopifyCart | null }} */
  const data = await gql(
    (access) => `query TetherCart($id: ID!) { cart(id: $id) { ...TetherCart } }\n${cartFragment(access)}`,
    { id },
  );
  return data.cart;
}

/**
 * @param {string} id
 * @returns {Promise<string | null>} The cart's current checkout URL, `null` when Shopify doesn't have the cart.
 */
export async function fetchCheckoutUrl(id) {
  /** @type {{ cart: { checkoutUrl: string } | null }} */
  const data = await gql('query TetherCheckout($id: ID!) { cart(id: $id) { checkoutUrl } }', { id });
  return data.cart?.checkoutUrl ?? null;
}

/**
 * @typedef {object} LinePatch A change to one line, for `updateLine`.
 * @property {number} [quantity] 0 or less removes the line.
 * @property {string | number | null} [sellingPlanId] `null` switches the line back to one-time purchase.
 * @property {Attributes} [attributes]
 * @property {string | number} [merchandiseId]
 * @property {string | number} [variantId]
 */

/**
 * @param {string} lineId
 * @param {number | LinePatch} patch
 * @returns {Record<string, unknown>} Shopify's `CartLineUpdateInput`.
 */
export function toLineUpdate(lineId, patch) {
  const change = typeof patch === 'number' ? { quantity: patch } : patch;
  /** @type {Record<string, unknown>} */
  const line = { id: lineId };
  if (change.quantity !== undefined) line['quantity'] = change.quantity;
  if ('sellingPlanId' in change)
    line['sellingPlanId'] = change.sellingPlanId ? GID.sellingPlan(change.sellingPlanId) : null;
  if (change.attributes) line['attributes'] = toAttributes(change.attributes);
  const variantId = change.merchandiseId || change.variantId;
  if (variantId) line['merchandiseId'] = GID.variant(variantId);
  return line;
}

/**
 * @param {Record<string, unknown>[]} lines
 * @returns {Promise<ShopifyCart | null>}
 */
export const updateLines = (lines) =>
  mutateCart({
    name: 'cartLinesUpdate',
    args: '$lines: [CartLineUpdateInput!]!',
    inner: 'lines: $lines',
    variables: { lines },
    createInput: null,
  });

/**
 * @param {string[]} lineIds
 * @returns {Promise<ShopifyCart | null>}
 */
export const removeLines = (lineIds) =>
  mutateCart({
    name: 'cartLinesRemove',
    args: '$lineIds: [ID!]!',
    inner: 'lineIds: $lineIds',
    variables: { lineIds },
    createInput: null,
  });

/**
 * @param {string} lineId
 * @param {number} target
 * @returns {Promise<ShopifyCart | null>} The cart once `lineId` has `target` (0 removes it).
 */
export const setLineQuantity = (lineId, target) =>
  target > 0 ? updateLines([{ id: lineId, quantity: target }]) : removeLines([lineId]);
