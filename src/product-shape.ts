/**
 * The structure of Tether's product fragment, checked on a value read from the page or from a Storefront answer
 * before it is used as a `Product`. Rendering walks the product's lists and prices without checking each step, so a
 * truncated or hand-written entry, or an answer missing fields, would otherwise fail deep inside a render instead of
 * being skipped or refused.
 */
import { matches } from './client.ts';
import { field, isRecord } from '../server/src/shared/json.ts';
import type { Shape } from './client.ts';
import type { Product } from './fragments.ts';
import type { PageInfo } from './loader.ts';

/** A page of a GraphQL connection of products. */
export interface ProductConnection {
  nodes: Product[];
  pageInfo: PageInfo;
}

/** A Storefront API `MoneyV2`. */
export const MONEY = { amount: 'string', currencyCode: 'string' } as const satisfies Shape;

/**
 * A product's id, handle and title, and every list and price a render walks without a fallback: images, options,
 * variants (each with an id, a price and its options) and the price range. Text fields are written as text, and the
 * selling plan lists are read with a fallback, so they need no check.
 */
export const PRODUCT = {
  id: 'string',
  handle: 'string',
  title: 'string',
  options: ['object'],
  images: { nodes: ['object'] },
  priceRange: { minVariantPrice: MONEY, maxVariantPrice: MONEY },
  variants: { nodes: [{ id: 'string', price: MONEY, selectedOptions: ['object'] }] },
} as const satisfies Shape;

/** A page of products, with the `pageInfo` paging reads. */
export const PRODUCT_CONNECTION = { nodes: [PRODUCT], pageInfo: { hasNextPage: 'boolean' } } as const satisfies Shape;

/** True for a value with the structure of `PRODUCT` and a non-empty id and handle. */
export const isProductShape = (value: unknown): value is Product =>
  field(value, 'id') !== '' && field(value, 'handle') !== '' && matches(value, PRODUCT);

/**
 * A node a lookup by gid answers: a product, or a node of another type, for which `... on Product` selects no field
 * (no `id`).
 */
export const PRODUCT_NODE = (node: unknown): boolean =>
  isRecord(node) && (node['id'] === undefined || matches(node, PRODUCT));
