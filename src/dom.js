/**
 * The browser modules' DOM toolkit: what Shopify values look like on the page (money, dates, text, images, lists)
 * and how elements show, hide and report layout changes. Attribute names go through `attr()` so the prefix is
 * configurable. The optional parts import all of it from here (`window.Tether.__core['dom.js']`).
 */
import { cfg, reportError, warn } from './config.js';
import { attr, emit, get } from './markup.js';
import { storeHtmlFragment } from './store-html.js';
import { isRecord } from '../server/src/shared/json.js';
import { formatMoney as formatMoneyIn, productUrl as productUrlFor } from './shopify-values.js';
/** @import { Money } from './shopify-values.js' */

export { attr, sel, get, has, qsa, scoped, emit } from './markup.js';
export { imageUrl, cdnUrl, sameImage, setImage } from './images.js';
export { hasTemplate, repeat, repeatKeyed } from './repeaters.js';

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
 * @param {string | null | undefined} handle
 * @param {string | null} [id]
 * @returns {string | null} `null` without the handle or id the path needs.
 */
export function productUrl(handle, id) {
  return productUrlFor(cfg.productPath || '/product', handle, id);
}

/**
 * `Intl` throws a RangeError for a locale or currency it doesn't know; the caller then shows a plain fallback.
 *
 * @template T
 * @param {() => T} format
 * @param {T} fallback
 * @returns {T}
 */
function formatOr(format, fallback) {
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
 * @param {number | null | undefined} percentage
 * @param {string | undefined} [locale]
 * @returns {string} `''` for no or a zero percentage.
 */
export function formatPercent(percentage, locale = cfg.locale) {
  if (!percentage) return '';
  const format = () =>
    new Intl.NumberFormat(locale || undefined, { style: 'percent', maximumFractionDigits: 0 }).format(percentage / 100);
  return formatOr(format, `${percentage}%`);
}

/**
 * Money in the configured locale, through the site's `formatMoney` when it has one.
 *
 * @param {Money | null | undefined} money
 */
export function formatMoney(money) {
  if (!money) return '';
  if (cfg.formatMoney) return cfg.formatMoney(money, cfg.locale);
  return formatMoneyIn(money, cfg.locale);
}

/**
 * @param {string | null | undefined} iso
 * @returns {string} The date in the configured locale, `''` without one.
 */
export function formatDate(iso) {
  if (!iso) return '';
  return formatOr(() => new Date(iso).toLocaleDateString(cfg.locale || undefined), '');
}

/**
 * Writes HTML from the Shopify admin (product and collection descriptions) into `el`, with script removed
 * (`store-html.js`). Everything else from Shopify is written as text (`setText`).
 *
 * @param {Element} el
 * @param {string | null | undefined} html
 */
export function setStoreHtml(el, html) {
  el.replaceChildren(storeHtmlFragment(html, el.ownerDocument));
}

/**
 * @param {Element} el
 * @returns {el is HTMLInputElement | HTMLTextAreaElement}
 */
const isTextField = (el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';

/**
 * @param {Element} el
 * @returns {el is HTMLInputElement}
 */
const isInput = (el) => el.tagName === 'INPUT';

/**
 * Sets the text of `el`, or its value when it is a form field.
 *
 * @param {Element} el
 * @param {string | number | boolean | null | undefined} value `null` and `undefined` clear it.
 */
export function setText(el, value) {
  const text = value == null ? '' : String(value);
  if (isTextField(el)) el.value = text;
  else el.textContent = text;
}

/** @param {Element} el */
const readText = (el) => (isTextField(el) ? el.value : el.textContent);

/**
 * `setText` that hands a change after the first render to `onValueChange`, for scramble and roll effects.
 *
 * @param {HTMLElement} el
 * @param {string | number | boolean | null | undefined} value
 */
export function setTextTracked(el, value) {
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
 *
 * @param {HTMLElement} el
 */
function reveal(el) {
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

/**
 * Shows or hides `el`, restoring its own display value when shown again.
 *
 * @param {HTMLElement} el
 * @param {boolean} visible
 */
export function show(el, visible) {
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

/**
 * Marks an option button or input as chosen: `is-selected`, `aria-pressed`, and its own or inner radio/checkbox.
 *
 * @param {Element} el
 * @param {boolean} selected
 */
export function setSelected(el, selected) {
  el.classList.toggle('is-selected', selected);
  el.setAttribute('aria-pressed', selected ? 'true' : 'false');
  if (isInput(el) && (el.type === 'radio' || el.type === 'checkbox')) el.checked = selected;
  const input = el.querySelector('input[type="radio"],input[type="checkbox"]');
  if (input && isInput(input)) input.checked = selected;
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let layoutTimer;

/**
 * Async renders change the page height after the site's page-transition hooks ran. After a burst of them this calls
 * `onLayoutChange` (else refreshes ScrollTrigger) and emits `tether:layout-changed`.
 *
 * @param {string} reason
 */
export function notifyLayoutChanged(reason) {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    // GSAP's ScrollTrigger, when the site has it, measures positions that a height change makes stale.
    const { ScrollTrigger } = /** @type {Window & { ScrollTrigger?: { refresh?: () => void } }} */ (window);
    if (cfg.onLayoutChange) cfg.onLayoutChange(reason);
    else ScrollTrigger?.refresh?.();
    emit('layout-changed', { reason });
  }, LAYOUT_DEBOUNCE_MS);
}

/**
 * Notifies a layout change (`<reason>:images`) once every image in `root` that is still loading has loaded or failed.
 *
 * @param {ParentNode} root
 * @param {string} reason
 */
export function watchImages(root, reason) {
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
 * @template T
 * @param {Element} el
 * @param {() => T | Promise<T>} task
 * @returns {Promise<T | undefined>} The task's result, `undefined` when it didn't run.
 */
export function busy(el, task) {
  if (el.getAttribute('aria-busy') === 'true') return Promise.resolve(undefined);
  el.setAttribute('aria-busy', 'true');
  return Promise.resolve()
    .then(task)
    .finally(() => {
      el.removeAttribute('aria-busy');
    });
}

/**
 * @param {Element | null | undefined} el
 * @param {string} name
 * @returns {unknown} The attribute's JSON, `null` when it is missing or not JSON (with a warning).
 */
export function parseJSONAttr(el, name) {
  const raw = el ? get(el, name) : null;
  if (!raw) return null;
  try {
    return /** @type {unknown} */ (JSON.parse(raw));
  } catch {
    warn(`invalid JSON in ${attr(name)}`, el);
    return null;
  }
}

/** @typedef {string | number | boolean | null | undefined} AttributeValue */

/**
 * @param {unknown} value
 * @returns {string} A JSON value as attribute text: `''` for none, an object or array as its JSON.
 */
function attributeText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // What else parsed JSON holds: objects and arrays.
  return JSON.stringify(value);
}

/**
 * `tether-line-attributes`, JSON the site writes: `{ a: 1 }` or `[{ key, value }]`. An array entry that isn't an
 * object is skipped.
 *
 * @param {unknown} json
 * @returns {{ key: string, value: string }[]}
 */
export function attributesFromJson(json) {
  if (Array.isArray(json)) {
    return /** @type {unknown[]} */ (json)
      .filter(isRecord)
      .map((entry) => ({ key: attributeText(entry['key']), value: attributeText(entry['value']) }));
  }
  if (!isRecord(json)) return [];
  return Object.entries(json).map(([key, value]) => ({ key, value: attributeText(value) }));
}

/**
 * `{ a: 1 }` or `[{ key, value }]` → `[{ key, value }]` as Shopify wants cart and line attributes.
 *
 * @param {Record<string, AttributeValue> | { key: string | number, value?: AttributeValue }[] | null | undefined} attributes
 * @returns {{ key: string, value: string }[]}
 */
export function toAttributes(attributes) {
  if (!attributes) return [];
  if (Array.isArray(attributes)) {
    return attributes.map((attribute) => ({ key: String(attribute.key), value: String(attribute.value ?? '') }));
  }
  return Object.entries(attributes).map(([key, value]) => ({ key, value: String(value ?? '') }));
}
