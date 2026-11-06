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
/** Marks an option button or input as chosen: `is-selected`, `aria-pressed`, and its own or inner radio/checkbox. */
export declare function setSelected(el: Element, selected: boolean): void;
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
