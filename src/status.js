// @ts-nocheck
/**
 * Where a product scope gets its key from, and the loading / ready / error /
 * not-found state of a scope (so a failing API never leaves a broken page).
 */
import { attr, sel, get, scoped, show } from './dom.js';

/**
 * tether-product values:
 *   "coffee-box"          handle, numeric id, gid or product URL (as before)
 *   "url:handle"          ?handle=... from the page URL (any param name: "url:p" -> ?p=)
 *   "url:path"            the last segment of the page path (/shop/coffee-box -> coffee-box)
 * Returns { key, fromUrl, raw }. key is null when the URL has no value.
 */
export function resolveProductKey(el, location = window.location, name = 'product') {
  const raw = (get(el, name) || '').trim();
  if (!raw.toLowerCase().startsWith('url:')) return { key: raw || null, fromUrl: false, raw };
  const what = raw.slice(4).trim();
  let key = null;
  if (what.toLowerCase() === 'path') {
    const parts = location.pathname.split('/').filter(Boolean);
    key = parts.length ? safeDecode(parts[parts.length - 1]) : null;
  } else {
    key = new URLSearchParams(location.search).get(what || 'handle');
  }
  key = key && key.trim() ? key.trim() : null;
  return { key, fromUrl: true, raw };
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Values of tether-show that follow the scope state. */
export const STATUS_KEYS = ['loading', 'ready', 'error', 'not-found'];

export const isNotFound = (err) => err?.code === 'NOT_FOUND';

/** Product scopes and lists both own their state elements; the nearest one wins. */
export const boundary = () => ['product', 'collection', 'products', 'recommendations'].map((n) => sel(n)).join(',');

/** True when `el` belongs to the scope `root` (not to a nested product or list). */
export const ownedBy = (el, root) => el === root || el.parentElement?.closest(boundary()) === root;

/**
 * Sets tether-state (loading | ready | error) and tether-error (not-found or an
 * error code) on `root`, toggles tether-show="loading|ready|error|not-found"
 * inside it, and disables add-to-cart buttons when there's no product.
 */
export function setScopeStatus(root, status, err) {
  const notFound = status === 'not-found';
  root.setAttribute(attr('state'), notFound ? 'error' : status);
  if (status === 'error' || notFound) root.setAttribute(attr('error'), notFound ? 'not-found' : err?.code || 'error');
  else root.removeAttribute(attr('error'));

  scoped(root, sel('show'), boundary()).forEach((el) => {
    const k = get(el, 'show');
    if (!STATUS_KEYS.includes(k)) return;
    show(el, k === status);
  });

  if (status === 'error' || notFound) {
    scoped(root, sel('add-to-cart'), boundary()).forEach((btn) => {
      btn.classList.add('is-disabled');
      btn.setAttribute('aria-disabled', 'true');
      if ('disabled' in btn) btn.disabled = true;
    });
  }
}
