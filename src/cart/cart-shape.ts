/**
 * The structure of Tether's cart fragment, checked on a Storefront answer before it is used as a `ShopifyCart`. The
 * cart's render, its totals and the cart API walk its lines and prices without checking each step. Text fields are
 * written as text, so they need no check.
 */
import { MONEY } from '../product-shape.ts';
import type { Shape } from '../client.ts';

const LINE = {
  id: 'string',
  quantity: 'number',
  attributes: ['object'],
  cost: { totalAmount: MONEY, subtotalAmount: MONEY, amountPerQuantity: MONEY },
  merchandise: { id: 'string', selectedOptions: ['object'], product: 'object' },
} as const satisfies Shape;

export const CART = {
  id: 'string',
  checkoutUrl: 'string',
  totalQuantity: 'number',
  attributes: ['object'],
  discountCodes: ['object'],
  cost: { totalAmount: MONEY, subtotalAmount: MONEY },
  lines: { nodes: [LINE] },
} as const satisfies Shape;
