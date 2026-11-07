/**
 * The browser modules' DOM toolkit: what Shopify values look like on the page (money, dates, text, images, lists)
 * and how elements show, hide and report layout changes. Attribute names go through `attr()` so the prefix is
 * configurable. The optional parts import all of it from here (`window.Tether.__core['dom.ts']`).
 */
import { callHook, cfg, warn } from './config.ts';
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
  const { formatMoney: siteFormat, locale } = cfg;
  const builtIn = () => formatMoneyIn(money, locale);
  return siteFormat ? callHook('formatMoney', () => siteFormat(money, locale), builtIn) : builtIn();
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
  if (before !== readText(el) && el.hasAttribute(SEEN))
    callHook('onValueChange', () => cfg.onValueChange?.(el, before));
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

const CHECKABLE = 'input[type="radio"],input[type="checkbox"]';
const CHECKED_ROLES = ['radio', 'checkbox', 'switch', 'menuitemradio', 'menuitemcheckbox'];
const BUTTON_INPUTS = ['button', 'submit', 'reset'];

/**
 * @returns The ARIA state that says `el` is chosen, as its role allows one. `null` for a radio or checkbox input, or
 *   an element around one, whose `checked` says it, and for an element whose own role takes none.
 */
function chosenState(el: Element): 'aria-pressed' | 'aria-checked' | 'aria-selected' | null {
  const role = el.getAttribute('role');
  if (role === 'button') return 'aria-pressed';
  if (role && CHECKED_ROLES.includes(role)) return 'aria-checked';
  if (role === 'option' || role === 'tab') return 'aria-selected';
  if (role) return null;
  if (isInput(el)) return BUTTON_INPUTS.includes(el.type) ? 'aria-pressed' : null;
  return el.querySelector(CHECKABLE) ? null : 'aria-pressed';
}

/**
 * Marks an option element as chosen: `is-selected`, the ARIA state its role takes (`chosenState`), and its own or
 * inner radio/checkbox. An element that is no button and has no role of its own (a Webflow button is a link) gets
 * `role="button"`, where `aria-pressed` is valid, and a place in the Tab order unless it has its own `tabindex`; the
 * product's events press it with Enter and Space.
 */
export function setSelected(el: Element, selected: boolean): void {
  el.classList.toggle('is-selected', selected);
  const state = chosenState(el);
  if (state === 'aria-pressed' && el.tagName !== 'BUTTON' && !isInput(el)) {
    el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  }
  if (state) el.setAttribute(state, String(selected));
  if (isInput(el) && el.matches(CHECKABLE)) el.checked = selected;
  const input = el.querySelector(CHECKABLE);
  if (input && isInput(input)) input.checked = selected;
}

/**
 * The id of the note an option value the visitor can't buy is described by. A site writes its own element with this id
 * to say it in the store's language; Tether adds a `hidden` English one to a page without.
 */
const UNAVAILABLE_NOTE = 'tether-unavailable';

/**
 * Describes `control` as unavailable, or no longer, through `aria-describedby`, keeping the ids the site gave it. A
 * description is read from hidden text and every major screen reader announces it, so nothing changes on screen.
 */
function describeUnavailable(control: Element, unavailable: boolean): void {
  if (unavailable && !document.getElementById(UNAVAILABLE_NOTE)) {
    const note = document.createElement('span');
    note.id = UNAVAILABLE_NOTE;
    note.hidden = true;
    note.textContent = 'Unavailable';
    document.body.append(note);
  }
  const ids = (control.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== UNAVAILABLE_NOTE);
  if (unavailable) ids.push(UNAVAILABLE_NOTE);
  if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
  else control.removeAttribute('aria-describedby');
}

/**
 * Marks an option element the visitor can't buy: `is-unavailable`, and the state assistive technology reads on the
 * control, the element itself or the radio/checkbox inside it. A plan or purchase toggle the variant can't use does
 * nothing when chosen, so it is `aria-disabled`. An option value still works, choosing it picks the closest variant
 * that has it, so it isn't disabled: it is described as unavailable (`describeUnavailable`).
 */
export function setUnavailable(el: Element, unavailable: boolean, choosing: 'does-nothing' | 'picks-closest'): void {
  el.classList.toggle('is-unavailable', unavailable);
  const isControl = chosenState(el) !== null || isInput(el);
  const control = isControl ? el : el.querySelector(CHECKABLE);
  if (!control) return;
  if (choosing === 'picks-closest') describeUnavailable(control, unavailable);
  else control.setAttribute('aria-disabled', String(unavailable));
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
    callHook('layout-changed', () => {
      if (cfg.onLayoutChange) cfg.onLayoutChange(reason);
      else refreshScrollTrigger();
    });
    emit('layout-changed', { reason });
  }, LAYOUT_DEBOUNCE_MS);
}

/**
 * Notifies a layout change (`<reason>:images`) once every image in `root` that is still loading has loaded or failed.
 */
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

/** The integers a count attribute takes, and the value it has when it is missing or invalid. */
interface IntegerRange {
  min: number;
  max?: number;
  fallback: number;
}

/** A whole number as text, the way attributes and quantity fields take one. */
export const INTEGER_TEXT = /^-?\d+$/;

/** The attributes `integerAttribute` has warned about, per element, so a list that reloads warns once. */
const invalidIntegerAttributes = new WeakMap<Element, Set<string>>();

function warnInvalidAttribute(el: Element, name: string, message: string): void {
  const warned = invalidIntegerAttributes.get(el) ?? new Set();
  invalidIntegerAttributes.set(el, warned);
  if (warned.has(name)) return;
  warned.add(name);
  warn(`${attr(name)} ${message}`, el);
}

/**
 * Parses a count attribute with the config's count-option rules: an integer above `max` is the site asking for as
 * much as there is, so it gets `max`; a missing or empty attribute is `fallback`, and so, with a warning, is one that
 * isn't an integer or is below `min`. An element warns once per attribute.
 */
export function integerAttribute(el: Element, name: string, { min, max, fallback }: IntegerRange): number {
  const raw = get(el, name)?.trim();
  if (!raw) return fallback;
  // Number() alone would also take `0x10` and `1e2`.
  const value = INTEGER_TEXT.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isNaN(value) || value < min) {
    warnInvalidAttribute(
      el,
      name,
      `${JSON.stringify(raw)} is not a whole number from ${String(min)}: using ${String(fallback)}`,
    );
    return fallback;
  }
  if (max === undefined || value <= max) return value;
  warnInvalidAttribute(el, name, `${raw} is more than its maximum: using ${String(max)}`);
  return max;
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
