/**
 * Shows or hides each `name` element whose value is one of `conditions`' keys; other values are left alone.
 *
 * @param name `show`, `order-show`, `address-show`…
 */
export declare function showIn(root: ParentNode, name: string, conditions: Readonly<Record<string, boolean>>): void;
/**
 * @param row A copy of a repeater's template.
 * @returns The `name` elements in `row`, and `row` itself when it carries `name`.
 */
export declare const bindsIn: (row: HTMLElement, name: string) => HTMLElement[];
/** @returns A Shopify enum as text: `PARTIALLY_FULFILLED` → `partially fulfilled`. */
export declare const enumText: (value: string | null | undefined) => string;
/** @returns Shopify's formatted address on one line. */
export declare const addressText: (address: {
    formatted?: string[] | null;
} | null | undefined) => string;
/** A bind's value, looked up by the attribute's text: only the table's own keys, never `constructor` and the like. */
export declare const ownValue: <T>(values: Readonly<Record<string, T>>, key: string) => T | undefined;
