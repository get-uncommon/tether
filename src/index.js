/**
 * Tether — Shopify <-> Webflow (or any HTML) sync via the Storefront API.
 *
 *   <script>window.TETHER_CONFIG = { domain: 'x.myshopify.com', token: '...' }</script>
 *   <script src="tether.min.js" defer></script>
 *
 * With page transitions (Barba, Swup): set autoMount: false, call
 * Tether.init() once and Tether.mount(container) after every page enter.
 */
import { cfg, configure, isConfigured, log, warn, reportError } from './config.js';
import { gql, TetherError, withContext } from './client.js';
import { Cart } from './cart.js';
import { ProductScope, scopes } from './product.js';
import { ListScope, listSelector } from './collection.js';
import {
  getProduct, getProducts, getRecommendations, clearProductCache, primeProduct, normalizeProductKey,
} from './loader.js';
import * as plans from './selling-plans.js';
import { attr, sel, get, qsa, emit, formatMoney, busy, parseJSONAttr, toAttributes } from './dom.js';

export const VERSION = '0.1.3';

const mountedProducts = new WeakSet();
const mountedLists = new WeakSet();
let initPromise = null;
let observer = null;

function within(root, selector) {
  return [...(root.matches?.(selector) ? [root] : []), ...qsa(root, selector)];
}

/** Mount every product scope and product list inside `root`. Safe to call repeatedly. */
export function mount(root = document) {
  if (!isConfigured()) return 0;
  let count = 0;

  within(root, listSelector()).forEach((el) => {
    if (mountedLists.has(el)) return;
    mountedLists.add(el);
    count++;
    const list = new ListScope(el);
    el.addEventListener(`${cfg.prefix}:list-rendered`, (e) => mount(e.detail.container));
    list.load();
  });

  within(root, sel('product')).forEach((el) => {
    if (mountedProducts.has(el)) return;
    const key = get(el, 'product');
    if (!key) {
      // List cards get their handle when the list renders.
      if (!el.closest(listSelector())) warn(`[${attr('product')}] without a value. Bind it to the Shopify handle field.`, el);
      return;
    }
    mountedProducts.add(el);
    count++;
    el.setAttribute(attr('state'), 'loading');
    getProduct(key)
      .then((p) => new ProductScope(el, p))
      .catch((err) => { el.setAttribute(attr('state'), 'error'); reportError(err, `product ${key}`); });
  });

  qsa(root, sel('account-link')).forEach((a) => {
    a.setAttribute('href', `https://${cfg.domain}/account`);
  });

  Cart.render();
  log(`mounted ${count} scope(s)`, root);
  return count;
}

/** Call before a page transition removes `root` (closes the drawer etc.). */
export function unmount() {
  Cart.close();
}

export function getScope(el) {
  const root = el?.closest?.(sel('product'));
  return root ? scopes.get(root) || null : null;
}

// ---------------------------------------------------------------------------
// Document-wide controls (delegated, so they survive page swaps)
// ---------------------------------------------------------------------------

let controlsBound = false;

function bindControls() {
  if (controlsBound) return;
  controlsBound = true;

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t?.closest) return;

    if (t.closest(sel('cart-open'))) { e.preventDefault(); Cart.toggle(); return; }
    if (t.closest(sel('cart-close'))) { e.preventDefault(); Cart.close(); return; }

    const clear = t.closest(sel('cart-clear'));
    if (clear) { e.preventDefault(); busy(clear, () => Cart.clear().catch((err) => reportError(err, 'cart clear'))); return; }

    const checkout = t.closest(sel('checkout'));
    if (checkout) { e.preventDefault(); busy(checkout, () => Cart.checkout()); return; }

    const line = t.closest(dataKeySel());
    if (line && line.closest(sel('cart-lines'))) {
      const id = line.getAttribute(`data-${cfg.prefix}-key`);
      const current = Cart.lines.find((l) => l.id === id);
      const run = (fn) => { e.preventDefault(); fn().catch((err) => reportError(err, 'cart line')); };
      if (t.closest(sel('line-remove'))) return run(() => Cart.removeLine(id));
      if (current && t.closest(sel('line-plus'))) return run(() => Cart.updateLine(id, current.quantity + 1));
      if (current && t.closest(sel('line-minus'))) return run(() => Cart.updateLine(id, current.quantity - 1));
    }

    const removeCode = t.closest(sel('discount-remove'));
    if (removeCode) {
      e.preventDefault();
      const code = removeCode.closest(sel('discount-code'))?.getAttribute(attr('discount-code'));
      if (code) Cart.removeDiscount(code).catch((err) => reportError(err, 'discount'));
      return;
    }

    const groupBtn = t.closest(sel('group-add'));
    if (groupBtn) { e.preventDefault(); busy(groupBtn, () => addGroup(groupBtn)); }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t?.closest) return;
    const lineEl = t.closest(dataKeySel());
    const id = lineEl?.getAttribute(`data-${cfg.prefix}-key`);
    if (id && t.matches(`input${sel('line', 'quantity')}`)) {
      Cart.updateLine(id, parseInt(t.value, 10) || 0).catch((err) => reportError(err, 'cart line'));
    } else if (id && t.matches(`select${sel('line-plan')}`)) {
      Cart.updateLine(id, { sellingPlanId: t.value || null }).catch((err) => reportError(err, 'cart line plan'));
    } else if (t.matches(sel('cart-note'))) {
      Cart.setNote(t.value).catch((err) => reportError(err, 'cart note'));
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest?.(sel('discount-form'));
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector(sel('discount-input')) || form.querySelector('input');
    const code = input?.value.trim();
    if (!code) return;
    busy(form, async () => {
      try {
        const cart = await Cart.applyDiscount(code);
        const ok = (cart?.discountCodes || []).find((d) => d.code.toLowerCase() === code.toLowerCase())?.applicable;
        form.classList.toggle('is-invalid', !ok);
        emit(ok ? 'discount-applied' : 'discount-invalid', { code }, form);
        if (ok && input) input.value = '';
      } catch (err) { form.classList.add('is-invalid'); reportError(err, 'discount'); }
    });
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && Cart.isOpen()) Cart.close(); });
}

function dataKeySel() { return `[data-${cfg.prefix}-key]`; }

/**
 * [tether-group] + [tether-group-add]: adds every product scope inside the
 * group in one request. Bundles, build-a-box, "complete the set".
 * Lines get attribute _group (and the group's tether-line-attributes).
 */
export async function addGroup(btn) {
  const group = btn.closest(sel('group'));
  if (!group) return null;
  const name = get(group, 'group');
  const extra = toAttributes(parseJSONAttr(group, 'line-attributes'));
  const groupAttrs = name ? [{ key: '_group', value: name }, ...extra] : extra;

  const lines = qsa(group, sel('product'))
    .map((el) => scopes.get(el))
    .filter((s) => s && s.variant?.availableForSale && s.quantity > 0)
    .map((s) => {
      const l = s.getLine();
      l.attributes = [...(l.attributes || []), ...groupAttrs];
      return l;
    });

  if (!lines.length) { warn('group-add: nothing selected'); return null; }
  try {
    const cart = await Cart.add(lines);
    emit('group-added', { group: name, lines }, group);
    return cart;
  } catch (err) { reportError(err, 'group add'); return null; }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function init(overrides = {}) {
  if (initPromise && !Object.keys(overrides).length) return initPromise;
  configure({ ...(window.TETHER_CONFIG || {}), ...overrides });

  if (!isConfigured()) {
    warn('TETHER_CONFIG is missing domain or token. Tether is idle.');
    initPromise = Promise.resolve(null);
    return initPromise;
  }

  bindControls();
  if (cfg.observe) startObserver();

  initPromise = Cart.init().then((cart) => {
    emit('ready', { cart });
    return api;
  });
  return initPromise;
}

function startObserver() {
  if (observer || typeof MutationObserver === 'undefined') return;
  let t = null;
  const queued = new Set();
  observer = new MutationObserver((muts) => {
    muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) queued.add(n); }));
    clearTimeout(t);
    t = setTimeout(() => { queued.forEach((n) => { if (n.isConnected) mount(n); }); queued.clear(); }, 50);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export const api = {
  VERSION,
  init,
  mount,
  unmount,
  get config() { return cfg; },
  get ready() { return initPromise || Promise.resolve(null); },
  query: gql,
  withContext,
  cart: Cart,
  getProduct,
  getProducts,
  getRecommendations,
  getScope,
  addGroup,
  primeProduct,
  normalizeProductKey,
  clearProductCache,
  formatMoney,
  plans,
  TetherError,
  on(name, fn) {
    const h = (e) => fn(e.detail, e);
    document.addEventListener(`${cfg.prefix}:${name}`, h);
    return () => document.removeEventListener(`${cfg.prefix}:${name}`, h);
  },
};

export default api;

// Auto-start for the plain <script> setup.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.Tether = api;
  const auto = window.TETHER_CONFIG && window.TETHER_CONFIG.autoMount !== false;
  if (auto) {
    const start = () => init().then(() => mount(document));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
}
