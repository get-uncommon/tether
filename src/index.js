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
import { resolveProductKey, setScopeStatus, isNotFound } from './status.js';
import { diagnose } from './diagnose.js';
import { detectMarket, rememberMarket, getLocalization, clearLocalization, toCountry, toLanguage } from './markets.js';
import { attr, sel, get, qsa, emit, formatMoney, busy, parseJSONAttr, toAttributes } from './dom.js';

export const VERSION = '0.3.1';

const mountedProducts = new WeakSet();
const mountedLists = new WeakSet();
// Live roots, for re-rendering after a country switch (pruned when disconnected).
const liveProducts = new Set();
const liveLists = new Set();
const requestToken = new WeakMap(); // product root -> latest request, so a slow old response can't win

function pruneLive() {
  liveProducts.forEach((el) => { if (!el.isConnected) liveProducts.delete(el); });
  liveLists.forEach((l) => { if (!l.root.isConnected) liveLists.delete(l); });
}
let initPromise = null;
let observer = null;

function within(root, selector) {
  return [...(root.matches?.(selector) ? [root] : []), ...qsa(root, selector)];
}

/** Mount every product scope and product list inside `root`. Safe to call repeatedly. */
export function mount(root = document) {
  if (!isConfigured()) return 0;
  let count = 0;
  pruneLive(); // page transitions detach old roots: don't keep them alive

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

  renderCountrySelects(root);

  qsa(root, sel('account-link')).forEach((a) => {
    a.setAttribute('href', `https://${cfg.domain}/account`);
  });

  Cart.render();
  log(`mounted ${count} scope(s)`, root);
  return count;
}

/** Mounts one product root. Returns true when a product request was started. */
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

// ---------------------------------------------------------------------------
// Markets: country select + switching
// ---------------------------------------------------------------------------

/**
 * select[tether-country-select]: countries the store sells to (Shopify Markets).
 * tether-country-label="{name} ({currency})" sets the option text ({name}, {code}, {currency}, {symbol}).
 * tether-country-bind="name|code|currency|symbol" shows the current country anywhere.
 */
function renderCountrySelects(root = document) {
  const selects = within(root, `select${sel('country-select')}`);
  const binds = within(root, sel('country-bind'));
  if (!selects.length && !binds.length) return Promise.resolve();
  return getLocalization().then((loc) => {
    const current = (cfg.country || loc.country?.isoCode || '').toUpperCase();
    const countries = [...(loc.availableCountries || [])].sort((a, b) => a.name.localeCompare(b.name, cfg.locale || undefined));
    const info = countries.find((c) => c.isoCode === current) || loc.country;
    const fill = (tpl, c) => tpl.replace(/\{name\}/g, c.name).replace(/\{code\}/g, c.isoCode)
      .replace(/\{currency\}/g, c.currency?.isoCode || '').replace(/\{symbol\}/g, c.currency?.symbol || '');
    selects.forEach((s) => {
      const tpl = s.getAttribute(attr('country-label')) || '{name} ({currency})';
      s.innerHTML = '';
      countries.forEach((c) => s.appendChild(new Option(fill(tpl, c), c.isoCode)));
      s.value = current;
      if (s.value !== current) s.selectedIndex = -1; // a country the store doesn't sell to
      s.disabled = countries.length < 2 && !s.hasAttribute(attr('always-enabled'));
    });
    binds.forEach((el) => {
      const k = get(el, 'country-bind') || 'name';
      const v = { name: info?.name, code: info?.isoCode, currency: info?.currency?.isoCode, symbol: info?.currency?.symbol }[k];
      el.textContent = v || '';
    });
  }).catch((err) => reportError(err, 'country select'));
}

/**
 * Switches the market: prices, currency and translations follow (@inContext), the cart's
 * buyerIdentity.countryCode is updated, and every product and list on the page re-renders.
 *   Tether.setCountry('DE')            Tether.setCountry('BE', { language: 'FR' })
 */
export async function setCountry(code, { language, remember = true } = {}) {
  const country = toCountry(code);
  if (!country) throw new TetherError(`Not a country code: ${code}`, { code: 'INVALID_COUNTRY' });
  const lang = language === undefined ? cfg.language : toLanguage(language);
  const changed = country !== String(cfg.country || '').toUpperCase() || lang !== cfg.language;
  cfg.country = country;
  cfg.language = lang || undefined;
  if (remember) rememberMarket({ country, language: lang });
  if (!changed) { renderCountrySelects(); return Cart.state; }

  clearProductCache();
  const jobs = [];
  if (language !== undefined) clearLocalization(); // country names follow the language
  // Only an existing cart moves; switching country never creates one.
  if (Cart.id()) jobs.push(Cart.setBuyerIdentity({ countryCode: country }, { create: false }).catch((err) => reportError(err, 'cart country')));

  pruneLive();
  liveLists.forEach((list) => jobs.push(list.load()));
  liveProducts.forEach((el) => {
    if (el.closest(listSelector())) return; // re-rendered by its list
    mountedProducts.delete(el);
    mountProduct(el);
  });

  renderCountrySelects();
  emit('country-changed', { country, language: cfg.language });
  await Promise.all(jobs);
  return Cart.state;
}

/** tether-page-title="{title} | My shop" on a product root sets document.title (dynamic product pages). */
function applyPageTitle(el, p) {
  const tpl = get(el, 'page-title');
  if (!tpl || typeof document === 'undefined') return;
  document.title = tpl.replace(/\{title\}/g, p.title).replace(/\{vendor\}/g, p.vendor || '').replace(/\{type\}/g, p.productType || '');
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

  // Detected market (saved choice, server hint, Webflow locale) wins over the static config.
  const market = detectMarket(cfg.markets);
  if (market.country) cfg.country = market.country;
  if (market.language) cfg.language = market.language;
  if (market.locale && !overrides.locale && !window.TETHER_CONFIG?.locale) cfg.locale = market.locale;
  if (market.sources && Object.keys(market.sources).length) log('market', market);

  bindControls();
  if (cfg.observe) startObserver();

  initPromise = Cart.init().then(async (cart) => {
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
  resolveProductKey,
  setCountry,
  detectMarket: (markets) => detectMarket(markets || cfg.markets),
  getLocalization,
  diagnose: (opts) => diagnose({ ...opts, version: VERSION }),
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
