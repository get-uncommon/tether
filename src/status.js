/**
 * Where a product scope gets its key from, and the state of a scope (loading, ready, error, not found), so a failing
 * API never leaves a broken page.
 */
import { attr, sel, get, scoped, show } from './dom.js';

/**
 * @typedef {object} ProductKeySource
 * @property {string | null} key The product to load; `null` when the attribute or the page URL has none.
 * @property {boolean} fromUrl The key comes from the page URL (`url:…`).
 * @property {string} raw The attribute's value as written.
 */

/** @typedef {'loading' | 'ready' | 'error' | 'not-found'} ScopeStatus */

const URL_SOURCE = 'url:';

/**
 * A path segment as text. A malformed escape (`%E0%A4%A`) is kept as written, which is how the browser shows it.
 *
 * @param {string} segment
 */
function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    if (error instanceof URIError) return segment;
    throw error;
  }
}

/**
 * Reads a `tether-product` value:
 * - `coffee-box`: a handle, numeric id, gid or product URL;
 * - `url:handle`: `?handle=` from the page URL (any parameter: `url:p` reads `?p=`);
 * - `url:path`: the last segment of the page path (`/shop/coffee-box` → `coffee-box`).
 *
 * @param {Element} el
 * @param {Pick<Location, 'pathname' | 'search'>} [location]
 * @param {string} [name] The attribute, without prefix.
 * @returns {ProductKeySource}
 */
export function resolveProductKey(el, location = window.location, name = 'product') {
  const raw = (get(el, name) ?? '').trim();
  if (!raw.toLowerCase().startsWith(URL_SOURCE)) return { key: raw || null, fromUrl: false, raw };
  const source = raw.slice(URL_SOURCE.length).trim();
  let key;
  if (source.toLowerCase() === 'path') {
    const segments = location.pathname.split('/').filter(Boolean);
    const segment = segments[segments.length - 1];
    key = segment === undefined ? null : decodePathSegment(segment);
  } else {
    key = new URLSearchParams(location.search).get(source || 'handle');
  }
  return { key: key?.trim() || null, fromUrl: true, raw };
}

/** @type {readonly ScopeStatus[]} The values of `tether-show` that follow the scope's state. */
export const STATUS_KEYS = ['loading', 'ready', 'error', 'not-found'];

/**
 * @param {unknown} value
 * @returns {value is ScopeStatus}
 */
const isScopeStatus = (value) => STATUS_KEYS.some((status) => status === value);

/**
 * @param {unknown} error
 * @returns {unknown} The error's `code` (a `TetherError` has one).
 */
const codeOf = (error) => (typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined);

/**
 * @param {unknown} error
 * @returns {boolean} True for a `TetherError` with code `NOT_FOUND`.
 */
export const isNotFound = (error) => codeOf(error) === 'NOT_FOUND';

/** @returns {string} The selector of every scope that owns its state elements; the nearest one wins. */
export const boundary = () =>
  ['product', 'collection', 'products', 'recommendations'].map((name) => sel(name)).join(',');

/**
 * @param {Element} el
 * @param {Element} root
 * @returns {boolean} True when `el` belongs to the scope `root`, not to a scope nested in it.
 */
export const ownedBy = (el, root) => el === root || el.parentElement?.closest(boundary()) === root;

/**
 * @param {unknown} error
 * @returns {string} The error's code for `tether-error`, `error` without one.
 */
function errorCode(error) {
  const code = codeOf(error);
  return typeof code === 'string' && code ? code : 'error';
}

/**
 * Sets `tether-state` (loading | ready | error) and `tether-error` (not-found or an error code) on `root`, toggles
 * `tether-show="loading|ready|error|not-found"` inside it, and disables its add-to-cart buttons when there's no
 * product.
 *
 * @param {Element} root
 * @param {ScopeStatus} status
 * @param {unknown} [error]
 */
export function setScopeStatus(root, status, error) {
  const notFound = status === 'not-found';
  const failed = status === 'error' || notFound;
  root.setAttribute(attr('state'), notFound ? 'error' : status);
  if (failed) root.setAttribute(attr('error'), notFound ? 'not-found' : errorCode(error));
  else root.removeAttribute(attr('error'));

  scoped(root, sel('show'), boundary()).forEach((el) => {
    const shows = get(el, 'show');
    if (isScopeStatus(shows)) show(el, shows === status);
  });

  if (!failed) return;
  scoped(root, sel('add-to-cart'), boundary()).forEach((button) => {
    button.classList.add('is-disabled');
    button.setAttribute('aria-disabled', 'true');
    if ('disabled' in button) button.disabled = true;
  });
}
