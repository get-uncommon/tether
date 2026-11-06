/**
 * The account markup's shared vocabulary: `tether-*-show` conditions, binds on a template row (the row itself may
 * carry one), and how Shopify's enum values and formatted addresses read on the page.
 */
import { get, qsa, sel, show } from '../dom.ts';

/**
 * Shows or hides each `name` element whose value is one of `conditions`' keys; other values are left alone.
 *
 * @param name `show`, `order-show`, `address-show`…
 */
export function showIn(root: ParentNode, name: string, conditions: Readonly<Record<string, boolean>>): void {
  qsa(root, sel(name)).forEach((el) => {
    const key = get(el, name) ?? '';
    if (Object.hasOwn(conditions, key)) show(el, conditions[key] === true);
  });
}

/**
 * @param row A copy of a repeater's template.
 * @returns The `name` elements in `row`, and `row` itself when it carries `name`.
 */
export const bindsIn = (row: HTMLElement, name: string): HTMLElement[] =>
  qsa(row, sel(name)).concat(row.matches(sel(name)) ? [row] : []);

/** @returns A Shopify enum as text: `PARTIALLY_FULFILLED` → `partially fulfilled`. */
export const enumText = (value: string | null | undefined): string =>
  value ? value.toLowerCase().replace(/_/g, ' ') : '';

/** @returns Shopify's formatted address on one line. */
export const addressText = (address: { formatted?: string[] | null } | null | undefined): string =>
  (address?.formatted ?? []).join(', ');

/** A bind's value, looked up by the attribute's text: only the table's own keys, never `constructor` and the like. */
export const ownValue = <T>(values: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(values, key) ? values[key] : undefined;
