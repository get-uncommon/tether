import type { Money } from './shopify-values.js';
export { attr, sel, get, has, qsa, scoped, emit, ownEvent, isOwnEvent, ANALYTICS_EVENTS } from './markup.js';
export { imageUrl, cdnUrl, sameImage, setImage } from './images.js';
export { hasTemplate, repeat, repeatKeyed } from './repeaters.js';
/**
 * The product page of a product (`productPath`).
 *
 * @returns `null` without the handle or id the path needs.
 */
export declare function productUrl(handle: string | null | undefined, id?: string | null): string | null;
/**
 * `30` → `30%` (en, nl) or `30 %` (de, fr), in the configured locale.
 *
 * @returns `''` for no or a zero percentage.
 */
export declare function formatPercent(percentage: number | null | undefined, locale?: string | undefined): string;
/** Money in the configured locale, through the site's `formatMoney` when it has one. */
export declare function formatMoney(money: Money | null | undefined): string;
/** @returns The date in the configured locale, `''` without one. */
export declare function formatDate(iso: string | null | undefined): string;
/**
 * Writes HTML from the Shopify admin (product and collection descriptions) into `el`, with script removed
 * (`store-html.ts`). Everything else from Shopify is written as text (`setText`).
 */
export declare function setStoreHtml(el: Element, html: string | null | undefined): void;
/**
 * Sets the text of `el`, or its value when it is a form field.
 *
 * @param value `null` and `undefined` clear it.
 */
export declare function setText(el: Element, value: string | number | boolean | null | undefined): void;
/** `setText` that hands a change after the first render to `onValueChange`, for scramble and roll effects. */
export declare function setTextTracked(el: HTMLElement, value: string | number | boolean | null | undefined): void;
/** Shows or hides `el`, restoring its own display value when shown again. */
export declare function show(el: HTMLElement, visible: boolean): void;
/**
 * Marks an option element as chosen: `is-selected`, the ARIA state its role takes (`chosenState`), and its own or
 * inner radio/checkbox. An element that is no button and has no role of its own (a Webflow button is a link) gets
 * `role="button"`, where `aria-pressed` is valid, and a place in the Tab order unless it has its own `tabindex`; the
 * product's events press it with Enter and Space.
 */
export declare function setSelected(el: Element, selected: boolean): void;
/**
 * Marks an option element the visitor can't buy: `is-unavailable`, and `aria-disabled` on the control assistive
 * technology reads, the element itself or the radio/checkbox inside it. It stays clickable: choosing it picks the
 * closest variant that has it.
 */
export declare function setUnavailable(el: Element, unavailable: boolean): void;
/**
 * A global the page's own scripts set on `window`: `TETHER_CONFIG`, the site's config, `TETHER_INTEGRATION`, set by a
 * framework integration (Astro) that starts Tether itself, and GSAP's `ScrollTrigger`. Another script wrote it, so it
 * is read as unknown and checked where it is used.
 */
export declare const pageGlobal: (name: "TETHER_CONFIG" | "TETHER_INTEGRATION" | "ScrollTrigger") => unknown;
/**
 * Async renders change the page height after the site's page-transition hooks ran. After a burst of them this calls
 * `onLayoutChange` (else refreshes ScrollTrigger) and emits `tether:layout-changed`, also when either of those throws.
 */
export declare function notifyLayoutChanged(reason: string): void;
/**
 * Notifies a layout change (`<reason>:images`) once every image in `root` that is still loading has loaded or failed.
 */
export declare function watchImages(root: ParentNode, reason: string): void;
/**
 * Runs `task` with `aria-busy` on `el`; does nothing while `el` is already busy.
 *
 * @returns The task's result, `undefined` when it didn't run.
 */
export declare function busy<T>(el: Element, task: () => T | Promise<T>): Promise<T | undefined>;
/** @returns The attribute's JSON, `null` when it is missing or not JSON (with a warning). */
export declare function parseJSONAttr(el: Element | null | undefined, name: string): unknown;
/** The integers a count attribute takes, and the value it has when it is missing or invalid. */
interface IntegerRange {
    min: number;
    max?: number;
    fallback: number;
}
/** A whole number as text, the way attributes and quantity fields take one. */
export declare const INTEGER_TEXT: RegExp;
/**
 * Parses a count attribute with the config's count-option rules: an integer above `max` is the site asking for as
 * much as there is, so it gets `max`; a missing or empty attribute is `fallback`, and so, with a warning, is one that
 * isn't an integer or is below `min`. An element warns once per attribute.
 */
export declare function integerAttribute(el: Element, name: string, { min, max, fallback }: IntegerRange): number;
export type AttributeValue = string | number | boolean | null | undefined;
/**
 * `tether-line-attributes`, JSON the site writes: `{ a: 1 }` or `[{ key, value }]`. An array entry that isn't an
 * object is skipped.
 */
export declare function attributesFromJson(json: unknown): {
    key: string;
    value: string;
}[];
/** `{ a: 1 }` or `[{ key, value }]` → `[{ key, value }]` as Shopify wants cart and line attributes. */
export declare function toAttributes(attributes: Record<string, AttributeValue> | {
    key: string | number;
    value?: AttributeValue;
}[] | null | undefined): {
    key: string;
    value: string;
}[];
