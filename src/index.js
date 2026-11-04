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
import { mountedLists, liveLists, pruneLive, within, mountProduct, retryFailed, hydrateFromPage, settleMarket, trackMarket } from './mounting.js';

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
    trackMarket(list.load());
  });

  within(root, sel('product')).forEach((el) => { if (mountProduct(el)) count++; });

  // The country select lives in the optional markets part: load it only when the page uses it.
  if (within(root, `${sel('country-select')},${sel('country-bind')}`).length) {
    loadPart('markets').then((m) => m.renderCountrySelects(root)).catch((err) => reportError(err, 'markets'));
  }

  // Search as you type: its own optional part, only for pages that have it.
  if (within(root, sel('search')).length) {
    loadPart('search').then((m) => m.mountSearch(root)).catch((err) => reportError(err, 'search'));
  }

  qsa(root, sel('account-link')).forEach((a) => {
    a.setAttribute('href', `https://${cfg.domain}/account`);
  });

  settleMarket();
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
      if (t.closest(sel('line-remove'))) { line.classList.add('is-busy'); return run(() => Cart.removeLine(id)); }
      if (current && t.closest(sel('line-plus'))) return run(() => Cart.changeQuantity(id, 1));
      if (current && t.closest(sel('line-minus'))) return run(() => Cart.changeQuantity(id, -1));
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
    // The line shows is-busy / aria-busy until Shopify has answered (removed by the next render).
    const busyLine = (p, what) => { lineEl.classList.add('is-busy'); lineEl.setAttribute('aria-busy', 'true'); p.catch((err) => reportError(err, what)); };
    if (id && t.matches(`input${sel('line', 'quantity')}`)) {
      busyLine(Cart.updateLine(id, parseInt(t.value, 10) || 0), 'cart line');
    } else if (id && t.matches(`select${sel('line-plan')}`)) {
      busyLine(Cart.updateLine(id, { sellingPlanId: t.value || null }), 'cart line plan');
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
      const mark = (bad) => {
        form.classList.toggle('is-invalid', bad);
        if (input) { if (bad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
      };
      try {
        await Cart.applyDiscount(code);
        mark(false);
        emit('discount-applied', { code }, form);
        if (input) input.value = '';
      } catch (err) {
        mark(true);
        if (err?.code === 'INVALID_DISCOUNT') emit('discount-invalid', { code }, form); else reportError(err, 'discount');
      }
    });
  }, true); // capture: before a router (Astro's ClientRouter) turns the submit into a navigation
  document.addEventListener('input', (e) => {
    const f = e.target.closest?.(sel('discount-form'));
    if (f) { f.classList.remove('is-invalid'); e.target.removeAttribute?.('aria-invalid'); }
  });

  // Other tabs: the cart or the market changed there (handled by the extras part, loaded then).
  window.addEventListener('storage', (e) => {
    if (cfg.domain && e.key?.startsWith(`${cfg.prefix}:`)) loadPart('extras').then((m) => m.onStorage(e)).catch(() => {});
  });
  // Shareable variant links: only when turned on.
  document.addEventListener(`${cfg.prefix}:variant-changed`, (e) => {
    const root = e.target;
    if (cfg.variantUrl || root.hasAttribute?.(attr('variant-url'))) loadPart('extras').then((m) => m.writeVariantUrl(root, e.detail)).catch(() => {});
  });

  // Astro View Transitions (<ClientRouter />): mount every new page, close the cart while leaving.
  if (cfg.astro !== false) {
    document.addEventListener('astro:page-load', () => {
      // Navigated to a page of another market (e.g. /de/): switch first, then mount in that market.
      // Back on a normal page after one: the visitor's own choice, else the default market.
      let target = pageMarket();
      if (!target && onPageMarket) {
        try { target = JSON.parse(localStorage.getItem(`${cfg.prefix}:market:${cfg.domain}`) || 'null'); } catch { target = null; }
        target = target?.country ? target : baseMarket;
      }
      onPageMarket = Boolean(pageMarket());
      const differs = target?.country && (String(target.country).toUpperCase() !== String(cfg.country || '').toUpperCase()
        || String(target.language || '').toUpperCase() !== String(cfg.language || '').toUpperCase());
      if (differs) setCountry(target.country, { language: target.language ?? null, locale: target.locale, remember: false }).then(() => mount(document), () => mount(document));
      else mount(document);
    });
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
export const addGroup = (btn) => loadPart('extras').then((m) => m.addGroup(btn));

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
/**
 * A page built for one market (e.g. /de/ pages): <meta name="tether-page-country" content="DE">,
 * tether-page-language, tether-page-locale. Wins over the visitor's saved choice, isn't remembered.
 */
function pageMarket(doc = document) {
  const get = (n) => doc.querySelector(`meta[name="${cfg.prefix}-page-${n}"]`)?.getAttribute('content') || undefined;
  const country = get('country');
  return country ? { country: country.toUpperCase(), language: get('language'), locale: get('locale') } : null;
}

let baseMarket = null; // the configured market, before a visitor's or page's market applied
let onPageMarket = false;

async function applyMarket(overrides) {
  const m = cfg.markets || {};
  baseMarket = { country: cfg.country, language: cfg.language, locale: cfg.locale };
  const page = pageMarket();
  onPageMarket = Boolean(page);
  if (page) {
    cfg.country = page.country;
    cfg.language = page.language ? page.language.toUpperCase() : undefined;
    if (page.locale) cfg.locale = page.locale;
    return;
  }
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
