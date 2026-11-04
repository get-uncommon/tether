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
import { Cart, focusables } from './cart.js';
import { scopes } from './product.js';
import { ListScope, listSelector } from './collection.js';
import {
  getProduct, getProducts, getRecommendations, clearProductCache, primeProduct, normalizeProductKey,
} from './loader.js';
import * as plans from './selling-plans.js';
import { resolveProductKey } from './status.js';
import { attr, sel, get, qsa, emit, formatMoney, busy, parseJSONAttr, toAttributes, imageUrl } from './dom.js';
import { loadPart, coreModules } from './lazy.js';
import { mountedLists, liveLists, pruneLive, within, mountProduct, retryFailed, hydrateFromPage } from './mounting.js';

export const VERSION = '0.5.0';

let initPromise = null;
let observer = null;

/** Mount every product scope and product list inside `root`. Safe to call repeatedly. */
export function mount(root = document) {
  if (!isConfigured()) return 0;
  let count = 0;
  pruneLive(); // page transitions detach old roots: don't keep them alive
  hydrateFromPage(root); // products the server already rendered: no request needed

  within(root, listSelector()).forEach((el) => {
    if (mountedLists.has(el)) return;
    mountedLists.add(el);
    count++;
    const list = new ListScope(el);
    liveLists.add(list);
    el.addEventListener(`${cfg.prefix}:list-rendered`, (e) => mount(e.detail.container));
    list.load();
  });

  within(root, sel('product')).forEach((el) => { if (mountProduct(el)) count++; });

  // The country select lives in the optional markets part: load it only when the page uses it.
  if (within(root, `${sel('country-select')},${sel('country-bind')}`).length) {
    loadPart('markets').then((m) => m.renderCountrySelects(root)).catch((err) => reportError(err, 'markets'));
  }

  qsa(root, sel('account-link')).forEach((a) => {
    a.setAttribute('href', `https://${cfg.domain}/account`);
  });

  Cart.render();
  log(`mounted ${count} scope(s)`, root);
  return count;
}

// ---------------------------------------------------------------------------
// Markets: country select + switching
// ---------------------------------------------------------------------------

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
    } else if (t.matches(`select${sel('country-select')}`)) {
      if (t.value) setCountry(t.value).catch((err) => reportError(err, 'country'));
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
        // An invalid code doesn't stay in the cart (Shopify would warn about it on every change).
        if (!ok) await Cart.removeDiscount(code).catch(() => {});
        form.classList.toggle('is-invalid', !ok);
        emit(ok ? 'discount-applied' : 'discount-invalid', { code }, form);
        if (ok && input) input.value = '';
      } catch (err) { form.classList.add('is-invalid'); reportError(err, 'discount'); }
    });
  }, true); // capture: before a router (Astro's ClientRouter) turns the submit into a navigation
  document.addEventListener('input', (e) => { e.target.closest?.(sel('discount-form'))?.classList.remove('is-invalid'); });

  // Astro View Transitions (<ClientRouter />): mount every new page, close the cart while leaving.
  if (cfg.astro !== false) {
    document.addEventListener('astro:page-load', () => mount(document));
    document.addEventListener('astro:before-swap', () => unmount());
  }

  // Back online after a failed load: try the failed products and lists again.
  window.addEventListener('online', () => {
    retryFailed();
    liveLists.forEach((l) => { if (l.root.getAttribute(attr('state')) === 'error') l.load(); });
  });

  document.addEventListener('keydown', (e) => {
    if (!Cart.isOpen()) return;
    if (e.key === 'Escape') { Cart.close(); return; }
    if (e.key !== 'Tab' || cfg.cartFocus === false) return;
    // Keep Tab inside the open cart.
    const d = Cart.drawers().find((x) => x.classList.contains(cfg.cartDrawerOpenClass));
    const f = d ? focusables(d) : [];
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (!d.contains(document.activeElement) || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  });
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

  initPromise = applyMarket(overrides).then(() => Cart.init()).then(async (cart) => {
    // A saved cart from another market: move it to this one, so prices match the page.
    const want = cfg.country ? String(cfg.country).toUpperCase() : null;
    if (cart && want && cart.buyerIdentity?.countryCode && cart.buyerIdentity.countryCode !== want) {
      try { cart = await Cart.setBuyerIdentity({ countryCode: want }, { create: false }); } catch (err) { reportError(err, 'cart country'); }
    }
    emit('ready', { cart });
    return api;
  });
  return initPromise;
}

/**
 * Detected market (saved choice, server hint, Webflow locale) wins over the static config.
 * Without markets.detect only the visitor's saved choice applies, read here without loading
 * the markets part.
 */
async function applyMarket(overrides) {
  const m = cfg.markets || {};
  if (m.detect === false) return;
  let market = null;
  if (m.detect) {
    try { market = (await loadPart('markets')).detectMarket(m); } catch (err) { reportError(err, 'markets'); return; }
  } else if (m.remember !== false) {
    try { market = JSON.parse(localStorage.getItem(`${cfg.prefix}:market:${cfg.domain}`) || 'null'); } catch { /* none */ }
    if (market && !/^[A-Z]{2}$/.test(market.country || '')) market = null;
  }
  if (!market) return;
  if (market.country) cfg.country = market.country;
  if (market.language) cfg.language = market.language;
  if (market.locale && !overrides.locale) cfg.locale = market.locale; // the visitor's market wins over the default
  log('market', market);
}

/** Tether.setCountry('DE'): loads the markets part on first use. */
export function setCountry(code, opts) {
  return loadPart('markets').then((m) => m.setCountry(code, opts));
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
  imageUrl,
  plans,
  TetherError,
  resolveProductKey,
  setCountry,
  detectMarket: (markets) => loadPart('markets').then((m) => m.detectMarket(markets || cfg.markets)),
  getLocalization: () => loadPart('markets').then((m) => m.getLocalization()),
  diagnose: (opts) => loadPart('diagnose').then((m) => m.diagnose({ ...opts, version: VERSION })),
  __core: coreModules,
  __parts: {},
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
  // Not with a framework integration (Astro), which starts Tether itself.
  const auto = window.TETHER_CONFIG && window.TETHER_CONFIG.autoMount !== false && !window.TETHER_INTEGRATION;
  if (auto) {
    const start = () => init().then(() => mount(document));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
}
