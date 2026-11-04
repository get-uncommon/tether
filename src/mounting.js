/** Product scopes and lists that are mounted, shared by index.js and the optional markets part. */
import { cfg, log, warn, reportError } from './config.js';
import { ProductScope, scopes } from './product.js';
import { listSelector } from './collection.js';
import { getProduct } from './loader.js';
import { resolveProductKey, setScopeStatus, isNotFound } from './status.js';
import { attr, get, qsa, emit } from './dom.js';

export const mountedProducts = new WeakSet();
export const mountedLists = new WeakSet();
// Live roots, for re-rendering after a country switch (pruned when disconnected).
export const liveProducts = new Set();
export const liveLists = new Set();
const requestToken = new WeakMap(); // product root -> latest request, so a slow old response can't win

export function pruneLive() {
  liveProducts.forEach((el) => { if (!el.isConnected) liveProducts.delete(el); });
  liveLists.forEach((l) => { if (!l.root.isConnected) liveLists.delete(l); });
}
export function within(root, selector) {
  return [...(root.matches?.(selector) ? [root] : []), ...qsa(root, selector)];
}

export /** Mounts one product root. Returns true when a product request was started. */
function mountProduct(el) {
  if (mountedProducts.has(el)) return false;
  const { key, fromUrl, raw } = resolveProductKey(el);
  if (!key) {
    if (fromUrl) {
      // Dynamic product page opened without ?handle= (or an empty path).
      mountedProducts.add(el);
      setScopeStatus(el, 'not-found');
      emit('product-not-found', { key: null, source: raw }, el);
    } else if (!el.closest(listSelector())) {
      // List cards get their handle when the list renders.
      warn(`[${attr('product')}] without a value. Bind it to the Shopify handle field, or use "url:handle".`, el);
    }
    return false;
  }
  mountedProducts.add(el);
  liveProducts.add(el);
  const token = {};
  requestToken.set(el, token);
  const current = () => requestToken.get(el) === token;
  // A rendered scope keeps showing its content while it refreshes (e.g. country switch).
  if (!scopes.get(el)) setScopeStatus(el, 'loading');
  else el.setAttribute(attr('state'), 'updating');
  getProduct(key)
    .then((p) => {
      if (!current()) return;
      const existing = scopes.get(el);
      if (existing) existing.update(p);
      // eslint-disable-next-line no-new
      else new ProductScope(el, p);
      applyPageTitle(el, p);
    })
    .catch((err) => {
      if (!current()) return;
      const notFound = isNotFound(err);
      setScopeStatus(el, notFound ? 'not-found' : 'error', err);
      if (notFound) {
        emit('product-not-found', { key, source: raw }, el);
        // A typo in a URL isn't worth an alert; a CMS item pointing at a deleted product is.
        if (fromUrl) log(`product not found: ${key}`); else reportError(err, `product ${key}`);
      } else {
        reportError(err, `product ${key}`);
        emit('error', { error: err, context: 'product', key }, el);
      }
    });
  return true;
}

/** tether-page-title="{title} | My shop" on a product root sets document.title (dynamic product pages). */
function applyPageTitle(el, p) {
  const tpl = get(el, 'page-title');
  if (!tpl || typeof document === 'undefined') return;
  document.title = tpl.replace(/\{title\}/g, p.title).replace(/\{vendor\}/g, p.vendor || '').replace(/\{type\}/g, p.productType || '');
}


/** Product scopes that failed on a network/API error: loaded again when the browser is back online. */
export function retryFailed() {
  pruneLive();
  liveProducts.forEach((el) => {
    if (el.getAttribute(attr('state')) !== 'error' || el.getAttribute(attr('error')) === 'not-found') return;
    mountedProducts.delete(el);
    mountProduct(el);
  });
}
