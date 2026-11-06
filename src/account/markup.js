/**
 * The account markup's shared vocabulary: `tether-*-show` conditions, binds on a template row (the row itself may
 * carry one), and how Shopify's enum values and formatted addresses read on the page.
 */
import { get, qsa, sel, show } from '../dom.js';

/**
 * Shows or hides each `name` element whose value is one of `conditions`' keys; other values are left alone.
 *
 * @param {ParentNode} root
 * @param {string} name `show`, `order-show`, `address-show`…
 * @param {Readonly<Record<string, boolean>>} conditions
 */
export function showIn(root, name, conditions) {
  qsa(root, sel(name)).forEach((el) => {
    const key = get(el, name) ?? '';
    if (Object.hasOwn(conditions, key)) show(el, conditions[key] === true);
  });
}

/**
 * @param {HTMLElement} row A copy of a repeater's template.
 * @param {string} name
 * @returns {HTMLElement[]} The `name` elements in `row`, and `row` itself when it carries `name`.
 */
export const bindsIn = (row, name) => qsa(row, sel(name)).concat(row.matches(sel(name)) ? [row] : []);

/**
 * @param {string | null | undefined} value
 * @returns {string} A Shopify enum as text: `PARTIALLY_FULFILLED` → `partially fulfilled`.
 */
export const enumText = (value) => (value ? value.toLowerCase().replace(/_/g, ' ') : '');

/**
 * @param {{ formatted?: string[] | null } | null | undefined} address
 * @returns {string} Shopify's formatted address on one line.
 */
export const addressText = (address) => (address?.formatted ?? []).join(', ');

/**
 * A bind's value, looked up by the attribute's text: only the table's own keys, never `constructor` and the like.
 *
 * @template T
 * @param {Readonly<Record<string, T>>} values
 * @param {string} key
 * @returns {T | undefined}
 */
export const ownValue = (values, key) => (Object.hasOwn(values, key) ? values[key] : undefined);
