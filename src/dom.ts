/**
 * The browser modules' DOM toolkit: what Shopify values look like on the page (money, dates, text, images, lists)
 * and how elements show, hide and report layout changes. Attribute names go through `attr()` so the prefix is
 * configurable. The optional parts import all of it from here (`window.Tether.__core['dom.ts']`).
 */
import { cfg, reportError, warn } from './config.ts';
import { attr, emit, get } from './markup.ts';
import { storeHtmlFragment } from './store-html.ts';
import { isRecord } from '../server/src/shared/json.ts';
import { formatMoney as formatMoneyIn, productUrl as productUrlFor } from './shopify-values.ts';
import type { Money } from './shopify-values.ts';

export { attr, sel, get, has, qsa, scoped, emit, ownEvent, isOwnEvent, ANALYTICS_EVENTS } from './markup.ts';
export { imageUrl, cdnUrl, sameImage, setImage } from './images.ts';
export { hasTemplate, repeat, repeatKeyed } from './repeaters.ts';

/**
 * State Tether keeps on elements, as `data-tether-*` attributes whatever the prefix: sites style and test against
 * these names, so they stay fixed where the `tether-*` markup attributes follow `prefix`.
 */
const SEEN = 'data-tether-seen';
const SHOWN = 'data-tether-shown';
const PREVIOUS_DISPLAY = 'data-tether-prev-display';

/** Async renders change the page height in bursts; one notification per burst. */
const LAYOUT_DEBOUNCE_MS = 120;

/**
 * The product page of a product (`productPath`).
 *
 * @returns `null` without the handle or id the path needs.
 */
export function productUrl(handle: string | null | undefined, id?: string | null): string | null {
  return productUrlFor(cfg.productPath || '/product', handle, id);
}

/** `Intl` throws a RangeError for a locale or currency it doesn't know; the caller then shows a plain fallback. */
function formatOr<T>(format: () => T, fallback: T): T {
  try {
    return format();
  } catch (error) {
    if (error instanceof RangeError) return fallback;
    throw error;
  }
}

/**
 * `30` → `30%` (en, nl) or `30 %` (de, fr), in the configured locale.
 *
 * @returns `''` for no or a zero percentage.
 */
export function formatPercent(percentage: number | null | undefined, locale: string | undefined = cfg.locale): string {
  if (!percentage) return '';
  const format = () =>
    new Intl.NumberFormat(locale || undefined, { style: 'percent', maximumFractionDigits: 0 }).format(percentage / 100);
  return formatOr(format, `${percentage}%`);
}

/** Money in the configured locale, through the site's `formatMoney` when it has one. */
export function formatMoney(money: Money | null | undefined): string {
  if (!money) return '';
  if (cfg.formatMoney) return cfg.formatMoney(money, cfg.locale);
  return formatMoneyIn(money, cfg.locale);
}

/** @returns The date in the configured locale, `''` without one. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatOr(() => new Date(iso).toLocaleDateString(cfg.locale || undefined), '');
}

/**
 * Writes HTML from the Shopify admin (product and collection descriptions) into `el`, with script removed
 * (`store-html.ts`). Everything else from Shopify is written as text (`setText`).
 */
export function setStoreHtml(el: Element, html: string | null | undefined): void {
  el.replaceChildren(storeHtmlFragment(html, el.ownerDocument, cfg.embedOrigins));
}

const isTextField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
  el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';

const isInput = (el: Element): el is HTMLInputElement => el.tagName === 'INPUT';

/**
 * Sets the text of `el`, or its value when it is a form field.
 *
 * @param value `null` and `undefined` clear it.
 */
export function setText(el: Element, value: string | number | boolean | null | undefined): void {
  const text = value == null ? '' : String(value);
  if (isTextField(el)) el.value = text;
  else el.textContent = text;
}

const readText = (el: Element) => (isTextField(el) ? el.value : el.textContent);

/** `setText` that hands a change after the first render to `onValueChange`, for scramble and roll effects. */
export function setTextTracked(el: HTMLElement, value: string | number | boolean | null | undefined): void {
  const before = readText(el);
  setText(el, value);
  if (before !== readText(el) && el.hasAttribute(SEEN) && cfg.onValueChange) {
    try {
      cfg.onValueChange(el, before);
    } catch (error) {
      reportError(error, 'onValueChange');
    }
  }
  el.setAttribute(SEEN, '1');
}

/**
 * Shows an element hidden before the script ran (a class, an inline `display: none`, a `hidden` attribute), as
 * `block` or the value of `tether-display`.
 */
function reveal(el: HTMLElement): void {
  if (el.hasAttribute(SHOWN)) return;
  el.setAttribute(SHOWN, '');
  el.removeAttribute('hidden');
  const previous = el.getAttribute(PREVIOUS_DISPLAY);
  if (previous !== null) {
    el.style.display = previous;
    el.removeAttribute(PREVIOUS_DISPLAY);
  } else if (el.style.display === 'none') {
    el.style.display = '';
  }
  if (typeof getComputedStyle === 'function' && getComputedStyle(el).display === 'none') {
    el.style.display = el.getAttribute(attr('display')) || 'block';
  }
}

/** Shows or hides `el`, restoring its own display value when shown again. */
export function show(el: HTMLElement, visible: boolean): void {
  if (visible) {
    reveal(el);
    return;
  }
  el.removeAttribute(SHOWN);
  // The display value to restore is a real one, never 'none'.
  if (!el.hasAttribute(PREVIOUS_DISPLAY) && el.style.display !== 'none') {
    el.setAttribute(PREVIOUS_DISPLAY, el.style.display);
  }
  el.style.display = 'none';
}

/** Marks an option button or input as chosen: `is-selected`, `aria-pressed`, and its own or inner radio/checkbox. */
export function setSelected(el: Element, selected: boolean): void {
  el.classList.toggle('is-selected', selected);
  el.setAttribute('aria-pressed', selected ? 'true' : 'false');
  if (isInput(el) && (el.type === 'radio' || el.type === 'checkbox')) el.checked = selected;
  const input = el.querySelector('input[type="radio"],input[type="checkbox"]');
  if (input && isInput(input)) input.checked = selected;
}

let layoutTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A global the page's own scripts set on `window`: `TETHER_CONFIG`, the site's config, `TETHER_INTEGRATION`, set by a
 * framework integration (Astro) that starts Tether itself, and GSAP's `ScrollTrigger`. Another script wrote it, so it
 * is read as unknown and checked where it is used.
 */
export const pageGlobal = (name: 'TETHER_CONFIG' | 'TETHER_INTEGRATION' | 'ScrollTrigger'): unknown =>
  Reflect.get(window, name);

/** Refreshes GSAP's ScrollTrigger, when the site has it: it measures positions that a height change makes stale. */
function refreshScrollTrigger(): void {
  // ScrollTrigger is a class, and `refresh` a static method of it.
  const scrollTrigger = pageGlobal('ScrollTrigger');
  if (typeof scrollTrigger !== 'function') return;
  const refresh: unknown = Reflect.get(scrollTrigger, 'refresh');
  if (typeof refresh === 'function') Reflect.apply(refresh, scrollTrigger, []);
}

/**
 * Async renders change the page height after the site's page-transition hooks ran. After a burst of them this calls
 * `onLayoutChange` (else refreshes ScrollTrigger) and emits `tether:layout-changed`, also when either of those throws.
 */
export function notifyLayoutChanged(reason: string): void {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    try {
      if (cfg.onLayoutChange) cfg.onLayoutChange(reason);
      else refreshScrollTrigger();
    } catch (error) {
      reportError(error, 'layout-changed');
    }
    emit('layout-changed', { reason });
  }, LAYOUT_DEBOUNCE_MS);
}

/** Notifies a layout change (`<reason>:images`) once every image in `root` that is still loading has loaded or failed. */
export function watchImages(root: ParentNode, reason: string): void {
  const loading = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  let left = loading.length;
  const done = () => {
    left -= 1;
    if (left === 0) notifyLayoutChanged(`${reason}:images`);
  };
  loading.forEach((img) => {
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  });
}

/**
 * Runs `task` with `aria-busy` on `el`; does nothing while `el` is already busy.
 *
 * @returns The task's result, `undefined` when it didn't run.
 */
export function busy<T>(el: Element, task: () => T | Promise<T>): Promise<T | undefined> {
  if (el.getAttribute('aria-busy') === 'true') return Promise.resolve(undefined);
  el.setAttribute('aria-busy', 'true');
  return Promise.resolve()
    .then(task)
    .finally(() => {
      el.removeAttribute('aria-busy');
    });
}

/** @returns The attribute's JSON, `null` when it is missing or not JSON (with a warning). */
export function parseJSONAttr(el: Element | null | undefined, name: string): unknown {
  const raw = el ? get(el, name) : null;
  if (!raw) return null;
  try {
    const json: unknown = JSON.parse(raw);
    return json;
  } catch {
    warn(`invalid JSON in ${attr(name)}`, el);
    return null;
  }
}

export type AttributeValue = string | number | boolean | null | undefined;

/** @returns A JSON value as attribute text: `''` for none, an object or array as its JSON. */
function attributeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // What else parsed JSON holds: objects and arrays.
  return JSON.stringify(value);
}

/**
 * `tether-line-attributes`, JSON the site writes: `{ a: 1 }` or `[{ key, value }]`. An array entry that isn't an
 * object is skipped.
 */
export function attributesFromJson(json: unknown): { key: string; value: string }[] {
  if (Array.isArray(json)) {
    const entries: unknown[] = json;
    return entries
      .filter(isRecord)
      .map((entry) => ({ key: attributeText(entry['key']), value: attributeText(entry['value']) }));
  }
  if (!isRecord(json)) return [];
  return Object.entries(json).map(([key, value]) => ({ key, value: attributeText(value) }));
}

/** `{ a: 1 }` or `[{ key, value }]` → `[{ key, value }]` as Shopify wants cart and line attributes. */
export function toAttributes(
  attributes: Record<string, AttributeValue> | { key: string | number; value?: AttributeValue }[] | null | undefined,
): { key: string; value: string }[] {
  if (!attributes) return [];
  if (Array.isArray(attributes)) {
    return attributes.map((attribute) => ({ key: String(attribute.key), value: String(attribute.value ?? '') }));
  }
  return Object.entries(attributes).map(([key, value]) => ({ key, value: String(value ?? '') }));
}
