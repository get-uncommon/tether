/**
 * Checks that a value read from the page has the structure of Tether's product fragment, before it is used as a
 * `Product`. Rendering walks the product's lists and prices without checking each step, so a truncated or
 * hand-written entry would otherwise fail deep inside a render instead of being skipped.
 */
import { field, isRecord } from '../server/src/shared/json.js';
/** @import { Product } from './fragments.js' */

/**
 * @param {unknown} value
 * @returns {boolean} True for a Storefront API `MoneyV2`.
 */
function isMoney(value) {
  return typeof field(value, 'amount') === 'string' && typeof field(value, 'currencyCode') === 'string';
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown[] | null} `value[key].nodes` when it is a list (a GraphQL connection).
 */
function nodesOf(value, key) {
  const nodes = field(field(value, key), 'nodes');
  return Array.isArray(nodes) ? nodes : null;
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {boolean} True when `value[key]` has a min and a max price.
 */
function isPriceRange(value, key) {
  const range = field(value, key);
  return isMoney(field(range, 'minVariantPrice')) && isMoney(field(range, 'maxVariantPrice'));
}

/**
 * @param {unknown} value
 * @returns {boolean} True for a variant with what choosing and pricing it reads.
 */
function isVariantShape(value) {
  return (
    typeof field(value, 'id') === 'string' &&
    isMoney(field(value, 'price')) &&
    Array.isArray(field(value, 'selectedOptions'))
  );
}

/**
 * True when `value` has a non-empty id and handle, a title, and every list and price a render walks without a
 * fallback: images, options, variants (each with an id, a price and its options) and the price range. Text fields are
 * written as text, and the selling plan lists are read with a fallback, so they need no check.
 *
 * @type {(value: unknown) => value is Product}
 */
export const isProductShape = (value) => {
  if (!isRecord(value)) return false;
  const id = value['id'];
  const handle = value['handle'];
  const variants = nodesOf(value, 'variants');
  return (
    typeof id === 'string' &&
    id !== '' &&
    typeof handle === 'string' &&
    handle !== '' &&
    typeof value['title'] === 'string' &&
    Array.isArray(value['options']) &&
    nodesOf(value, 'images') !== null &&
    isPriceRange(value, 'priceRange') &&
    (variants?.every(isVariantShape) ?? false)
  );
};
