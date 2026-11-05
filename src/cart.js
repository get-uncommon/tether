/**
 * Cart: Shopify Cart API, state in localStorage, document-wide rendering.
 *
 * Every mutation is queued, so fast clicking never races. All public methods
 * return the updated cart.
 */
import { cfg, log, reportError } from './config.js';
import { gql, unwrap, TetherError } from './client.js';
import { cartFragment } from './fragments.js';
import { getProduct } from './loader.js';
import { allPlans, GID } from './selling-plans.js';
import {
  attr, sel, get, qsa, emit, formatMoney, setText, setTextTracked, setImage, show,
  repeat, repeatKeyed, toAttributes, productUrl, notifyLayoutChanged,
} from './dom.js';

/** Accepts many shapes and returns a Shopify CartLineInput. */
export function toLineInput(input, quantity = 1, opts = {}) {
  const src = typeof input === 'object' && input !== null ? input : { variantId: input, quantity, ...opts };
  const merchandiseId = GID.variant(src.merchandiseId || src.variantId || src.id);
  if (!merchandiseId) throw new TetherError('add(): variantId is required');
  const line = { merchandiseId, quantity: Math.max(1, parseInt(src.quantity ?? 1, 10) || 1) };
  const plan = src.sellingPlanId || src.sellingPlan;
  if (plan) line.sellingPlanId = GID.sellingPlan(plan);
  const attrs = toAttributes(src.attributes);
  if (attrs.length) line.attributes = attrs;
  return line;
}

function mutation(name, args, inner) {
  return `mutation Tether_${name}(${args}) {
  ${name}(${inner}) { cart { ...TetherCart } userErrors { field message } warnings { code message target } }
}
${cartFragment()}`;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let returnFocus = null;

/** Focusable elements inside an open drawer, in order (visible ones only). */
export const focusables = (d) => qsa(d, FOCUSABLE).filter((el) => el.offsetParent !== null || el === document.activeElement);

/** aria-expanded on the open buttons; dialog semantics on drawers (unless the markup has its own). */
function ariaState(open) {
  qsa(document, sel('cart-open')).forEach((b) => b.setAttribute('aria-expanded', String(open)));
  qsa(document, sel('cart-drawer')).forEach((d) => {
    if (!d.hasAttribute('role')) d.setAttribute('role', 'dialog');
    if (!d.hasAttribute('aria-label') && !d.hasAttribute('aria-labelledby')) d.setAttribute('aria-label', get(d, 'cart-label') || 'Cart');
    d.setAttribute('aria-modal', String(open));
    // Closed: hidden from screen readers and out of the Tab order (inert), like a closed dialog.
    if (!d.classList.contains(cfg.cartDrawerOpenClass)) { d.setAttribute('aria-hidden', 'true'); if (cfg.cartFocus !== false) d.inert = true; }
  });
}

const isMissingCart = (err) => /does not exist|not found|invalid id/i.test(err?.message || '');

export const Cart = {
  state: null,
  _chain: Promise.resolve(),

  id() { try { return localStorage.getItem(cfg.storageKey); } catch { return null; } },
  _setId(id) {
    try {
      if (id) localStorage.setItem(cfg.storageKey, id);
      else localStorage.removeItem(cfg.storageKey);
    } catch { /* private mode */ }
  },

  get lines() { return this.state?.lines?.nodes || []; },
  get count() { return this.state?.totalQuantity || 0; },

  lastError: null,
  /** Set by the account part while a customer is logged in (Customer Account API token). */
  customerAccessToken: null,
  /** line id -> { qty, done }: what quick +/- clicks asked for, shown until Shopify has answered. */
  pendingQty: new Map(),
  /** Shopify's notes on the last change, e.g. less stock than asked: [{ code, message }]. */
  warnings: [],
  /** true once the saved cart (or the absence of one) is known. */
  loaded: false,

  _take(payload, name) {
    const p = unwrap(payload, name);
    // Shopify can repeat a warning per line or code: each message once.
    this.warnings = (p.warnings || []).filter((w, i, all) => all.findIndex((x) => x.message === w.message) === i)
      .map((w) => ({ ...w, message: (typeof cfg.warningText === 'function' && cfg.warningText(w)) || w.message }));
    if (this.warnings.length) emit('cart-warning', { warnings: this.warnings });
    return p.cart;
  },

  _queue(fn) {
    const run = this._chain.then(fn, fn).then((value) => {
      if (this.lastError) { this.lastError = null; this.render(); }
      return value;
    }, (err) => {
      // tether-show="cart-error" becomes visible until the next successful cart call.
      this.lastError = err;
      this.render();
      emit('cart-error', { error: err });
      throw err;
    });
    this._chain = run.catch(() => {});
    return run;
  },

  _commit(cart, reason) {
    this.state = cart;
    if (cart?.id) this._setId(cart.id);
    // Other tabs reload the cart (storage event); the count also shows at once on the next page.
    try { localStorage.setItem(`${cfg.storageKey}:seen`, `${Date.now()}|${cart?.totalQuantity || 0}`); } catch { /* private mode */ }
    this.render();
    emit('cart-updated', { cart, reason });
    return cart;
  },

  async init() {
    const id = this.id();
    if (!id) { this.state = null; this.loaded = true; this.render(); emit('cart-updated', { cart: null, reason: 'load' }); return null; }
    // Until the saved cart has loaded, show its last known count instead of the page's 0.
    if (!this.loaded) {
      try {
        const n = (localStorage.getItem(`${cfg.storageKey}:seen`) || '').split('|')[1];
        if (n) qsa(document, sel('cart-count')).forEach((el) => { if (/^\s*0?\s*$/.test(el.textContent)) el.textContent = n; });
      } catch { /* private mode */ }
    }
    try {
      const data = await gql(`query TetherCart($id: ID!) { cart(id: $id) { ...TetherCart } }\n${cartFragment()}`, { id });
      if (!data.cart) { this._setId(null); this.state = null; } else this.state = data.cart;
    } catch (err) {
      reportError(err, 'cart load failed');
      this.lastError = err;
      // Keep the cart id on network/API errors: the cart is probably fine, Shopify isn't reachable.
      if (isMissingCart(err)) this._setId(null);
      this.state = null;
    }
    this.loaded = true;
    this.render();
    emit('cart-updated', { cart: this.state, reason: 'load' }); // islands (cart.subscribe) hear the loaded cart
    return this.state;
  },

  async _create(input = {}) {
    const buyerIdentity = cfg.country || this.customerAccessToken ? {
      ...(cfg.country ? { countryCode: String(cfg.country).toUpperCase() } : {}),
      ...(this.customerAccessToken ? { customerAccessToken: this.customerAccessToken } : {}),
    } : undefined;
    const data = await gql(
      mutation('cartCreate', '$input: CartInput!', 'input: $input'),
      { input: { buyerIdentity, ...input } },
    );
    return this._take(data.cartCreate, 'cartCreate');
  },

  /** Runs a cart mutation; creates a fresh cart if ours expired. */
  async _mutate(name, args, inner, variables, createInput) {
    const cartId = this.id();
    if (!cartId) return createInput ? this._create(createInput) : null;
    try {
      const data = await gql(mutation(name, `$cartId: ID!, ${args}`, `cartId: $cartId, ${inner}`), { ...variables, cartId });
      return this._take(data[name], name);
    } catch (err) {
      if (createInput && isMissingCart(err)) {
        log('cart expired, creating a new one');
        this._setId(null);
        return this._create(createInput);
      }
      throw err;
    }
  },

  /**
   * add('gid://shopify/ProductVariant/1', 2)
   * add({ variantId, quantity, sellingPlanId, attributes })
   * add([line, line])   // bundles / build-a-box in one request
   */
  add(input, quantity = 1, opts = {}) {
    const lines = (Array.isArray(input) ? input : [input]).map((l) => toLineInput(l, quantity, opts));
    return this._queue(async () => {
      const cart = await this._mutate('cartLinesAdd', '$lines: [CartLineInput!]!', 'lines: $lines', { lines }, { lines });
      this._commit(cart, 'add');
      emit('added', { cart, lines });
      if (cfg.openCartOnAdd) this.open();
      return cart;
    });
  },

  /**
   * updateLine(lineId, 3)
   * updateLine(lineId, { quantity, sellingPlanId, attributes })
   * sellingPlanId: null switches a line back to one-time purchase.
   */
  updateLine(lineId, patch) {
    const p = typeof patch === 'number' ? { quantity: patch } : { ...patch };
    if (p.quantity !== undefined && p.quantity <= 0) return this.removeLine(lineId);

    const line = { id: lineId };
    if (p.quantity !== undefined) line.quantity = p.quantity;
    if ('sellingPlanId' in p) line.sellingPlanId = p.sellingPlanId ? GID.sellingPlan(p.sellingPlanId) : null;
    if (p.attributes) line.attributes = toAttributes(p.attributes);
    if (p.merchandiseId || p.variantId) line.merchandiseId = GID.variant(p.merchandiseId || p.variantId);

    return this._queue(async () => this._commit(
      await this._mutate('cartLinesUpdate', '$lines: [CartLineUpdateInput!]!', 'lines: $lines', { lines: [line] }),
      'update',
    ));
  },

  /**
   * +1 / -1 for a line. Quick clicks add up: each builds on the quantity the last click asked for,
   * which shows at once (tether-line="quantity", Cart.lines) until Shopify has answered.
   */
  changeQuantity(lineId, delta) {
    const current = this.lines.find((l) => l.id === lineId);
    if (!current) return Promise.resolve(this.state);
    const target = Math.max(0, (this.pendingQty.get(lineId)?.qty ?? current.quantity) + delta);
    const job = { qty: target, done: false };
    this.pendingQty.set(lineId, job);
    this.render();
    emit('cart-updated', { cart: this.state, reason: 'pending' });
    const latest = () => this.pendingQty.get(lineId) === job;
    return this._queue(async () => {
      // Quick clicks: only the latest target goes to Shopify; the ones it replaced are skipped.
      if (!latest()) return this.state;
      const now = this.lines.find((l) => l.id === lineId);
      if (now && now.quantity === target) return this.state; // e.g. + then -: nothing to change
      const cart = target > 0
        ? await this._mutate('cartLinesUpdate', '$lines: [CartLineUpdateInput!]!', 'lines: $lines', { lines: [{ id: lineId, quantity: target }] })
        : await this._mutate('cartLinesRemove', '$lineIds: [ID!]!', 'lineIds: $lineIds', { lineIds: [lineId] });
      // A newer click is on its way: keep this answer, but show totals and count only once that
      // one is in (no stepping through every reply).
      if (!latest()) { this.state = cart; if (cart?.id) this._setId(cart.id); return cart; }
      return this._commit(cart, target > 0 ? 'update' : 'remove');
    }).finally(() => {
      if (latest()) { this.pendingQty.delete(lineId); this.render(); emit('cart-updated', { cart: this.state, reason: 'settled' }); }
    });
  },

  /** Quantity to show for a line: the one asked for while an update is on its way. */
  quantityOf(line) { return this.pendingQty.get(line.id)?.qty ?? line.quantity; },

  removeLine(lineIds) {
    const ids = Array.isArray(lineIds) ? lineIds : [lineIds];
    return this._queue(async () => this._commit(
      await this._mutate('cartLinesRemove', '$lineIds: [ID!]!', 'lineIds: $lineIds', { lineIds: ids }),
      'remove',
    ));
  },

  clear() {
    const ids = this.lines.map((l) => l.id);
    if (!ids.length) return Promise.resolve(this.state);
    return this.removeLine(ids);
  },

  setNote(note) {
    return this._queue(async () => this._commit(
      await this._mutate('cartNoteUpdate', '$note: String!', 'note: $note', { note: note ?? '' }, { note: note ?? '' }),
      'note',
    ));
  },

  /** Cart-level attributes, merged with existing ones. Value '' removes a key. */
  setAttributes(obj) {
    const add = toAttributes(obj);
    // Merged in the queue, with the cart as it is by then: quick calls in a row don't drop each other.
    return this._queue(async () => {
      const merged = new Map((this.state?.attributes || []).map((a) => [a.key, a.value]));
      add.forEach((a) => merged.set(a.key, a.value));
      const attributes = [...merged].filter(([, v]) => v !== '').map(([key, value]) => ({ key, value }));
      return this._commit(
        await this._mutate('cartAttributesUpdate', '$attributes: [AttributeInput!]!', 'attributes: $attributes', { attributes }, { attributes }),
        'attributes',
      );
    });
  },

  /** Replaces the discount codes. Pass [] to remove all. */
  setDiscountCodes(codes) {
    return this._queue(async () => {
      // A function gets the codes as they are by then (applyDiscount/removeDiscount in quick succession).
      const list = typeof codes === 'function' ? codes((this.state?.discountCodes || []).map((d) => d.code)) : codes;
      const discountCodes = (Array.isArray(list) ? list : [list]).map((c) => String(c).trim()).filter(Boolean);
      return this._commit(
        await this._mutate('cartDiscountCodesUpdate', '$discountCodes: [String!]!', 'discountCodes: $discountCodes', { discountCodes }, { discountCodes }),
        'discount',
      );
    });
  },

  /**
   * Adds a code. A code Shopify doesn't accept isn't kept in the cart (it would warn on every change):
   * it's removed again and the promise rejects with code INVALID_DISCOUNT.
   */
  async applyDiscount(code) {
    const cart = await this.setDiscountCodes((current) => [...new Set([...current, code])]);
    const hit = (cart?.discountCodes || []).find((d) => d.code.toLowerCase() === String(code).toLowerCase());
    if (hit?.applicable) return cart;
    await this.removeDiscount(code).catch(() => {});
    throw new TetherError(`Discount code not valid: ${code}`, { code: 'INVALID_DISCOUNT' });
  },

  removeDiscount(code) {
    const k = String(code).toLowerCase();
    return this.setDiscountCodes((current) => current.filter((c) => c.toLowerCase() !== k));
  },

  /** { countryCode, email, phone } — changes currency/prices for that market. */
  setBuyerIdentity(buyerIdentity, { create = true } = {}) {
    return this._queue(async () => {
      const cart = await this._mutate('cartBuyerIdentityUpdate', '$buyerIdentity: CartBuyerIdentityInput!', 'buyerIdentity: $buyerIdentity', { buyerIdentity }, create ? { buyerIdentity } : null)
        .catch((err) => {
          if (create || !isMissingCart(err)) throw err;
          this._setId(null); // expired cart: forget it instead of creating an empty one
          return null;
        });
      return this._commit(cart, 'buyer-identity');
    });
  },

  /**
   * Goes to Shopify checkout. With checkoutTarget '_blank' the tab is opened
   * inside the click (Safari blocks window.open after an await) and gets its
   * URL once we have it.
   */
  async checkout(target = cfg.checkoutTarget) {
    const id = this.id();
    if (!id || (this.state && !this.count)) return null; // nothing to check out
    const tab = target === '_blank' ? window.open('', '_blank') : null;
    if (tab) { try { tab.opener = null; } catch { /* ignore */ } }

    try {
      // Side by side: the cart's current checkout URL, and the account's own (beforeCheckout) if any.
      const fresh = gql('query TetherCheckout($id: ID!) { cart(id: $id) { checkoutUrl } }', { id }).then((d) => d.cart?.checkoutUrl);
      fresh.catch(() => {}); // not needed when beforeCheckout answers
      let url = (this.beforeCheckout && await this.beforeCheckout().catch(() => null)) || await fresh;
      if (url && this.customerAccessToken) url += `${url.includes('?') ? '&' : '?'}logged_in=true`;
      if (!url) throw new TetherError('No checkoutUrl (cart empty or expired)');
      emit('checkout', { url, cart: this.state });
      if (tab && !tab.closed) tab.location.href = url;
      else window.location.href = url;
      return url;
    } catch (err) {
      if (tab) tab.close();
      reportError(err, 'checkout failed');
      return null;
    }
  },

  // -------------------------------------------------------------- drawer

  drawers() { return qsa(document, sel('cart-drawer')); },

  /** Without a tether-cart-drawer (a React/Svelte/Vue cart), open/close still work: as state for subscribe. */
  _open: false,
  isOpen() {
    const ds = this.drawers();
    return ds.length ? ds.some((d) => d.classList.contains(cfg.cartDrawerOpenClass)) : this._open;
  },

  open() {
    if (this.isOpen()) return;
    this._open = true;
    const ds = this.drawers().filter((d) => get(d, 'cart-drawer') !== 'manual');
    ds.forEach((d) => { d.inert = false; d.classList.add(cfg.cartDrawerOpenClass); d.setAttribute('aria-hidden', 'false'); });
    ariaState(true);
    if (cfg.cartFocus !== false && ds[0]) {
      // Move focus into the cart (after the open transition has made it visible).
      returnFocus = document.activeElement;
      setTimeout(() => {
        const target = focusables(ds[0])[0] || ds[0];
        if (target === ds[0] && !ds[0].hasAttribute('tabindex')) ds[0].tabIndex = -1;
        target.focus?.({ preventScroll: true });
      }, 60);
    }
    if (typeof cfg.onCartOpen === 'function') cfg.onCartOpen(ds);
    emit('cart-toggled', { open: true });
  },

  close() {
    if (!this.isOpen()) return;
    this._open = false;
    const ds = this.drawers();
    const hadFocus = ds.some((d) => d.contains(document.activeElement));
    ds.forEach((d) => { d.classList.remove(cfg.cartDrawerOpenClass); d.setAttribute('aria-hidden', 'true'); if (cfg.cartFocus !== false) d.inert = true; });
    ariaState(false);
    if (hadFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
    if (typeof cfg.onCartClose === 'function') cfg.onCartClose(ds);
    emit('cart-toggled', { open: false });
  },

  toggle() { if (this.isOpen()) this.close(); else this.open(); },

  /**
   * For framework islands (React, Svelte, Vue): fn(cart, { open }) now and on every change.
   * Returns a function that stops listening.
   */
  subscribe(fn) {
    const call = () => fn(this.state, { open: this.isOpen(), count: this.count, loaded: this.loaded, warnings: this.warnings });
    const h = () => call();
    ['cart-updated', 'cart-toggled'].forEach((e) => document.addEventListener(`${cfg.prefix}:${e}`, h));
    call();
    return () => ['cart-updated', 'cart-toggled'].forEach((e) => document.removeEventListener(`${cfg.prefix}:${e}`, h));
  },

  // -------------------------------------------------------------- render

  render() {
    const cart = this.state;
    const count = cart ? cart.totalQuantity : 0;
    const money = (k) => (cart ? formatMoney(cart.cost?.[k]) : '');

    ariaState(this.isOpen());
    qsa(document, sel('cart-count')).forEach((el) => setTextTracked(el, count));
    qsa(document, sel('cart-subtotal')).forEach((el) => setTextTracked(el, money('subtotalAmount')));
    qsa(document, sel('cart-total')).forEach((el) => setTextTracked(el, money('totalAmount')));
    qsa(document, sel('cart-checkout-charge')).forEach((el) => setTextTracked(el, money('checkoutChargeAmount')));

    const hasSub = this.lines.some((l) => l.sellingPlanAllocation);
    const conds = {
      'cart-empty': count === 0,
      'cart-filled': count > 0,
      'cart-has-subscription': hasSub,
      'cart-no-subscription': !hasSub,
      'cart-has-discount': (cart?.discountCodes || []).some((d) => d.applicable),
      'cart-error': Boolean(this.lastError),
      'cart-warning': this.warnings.length > 0,
    };
    qsa(document, sel('cart-warning')).forEach((el) => setTextTracked(el, [...new Set(this.warnings.map((w) => w.message))].join(' ')));
    qsa(document, sel('show')).forEach((el) => {
      const k = get(el, 'show');
      if (k in conds && !el.closest(sel('product'))) show(el, conds[k]);
    });
    qsa(document, sel('checkout')).forEach((el) => {
      el.classList.toggle('is-disabled', !count);
      el.setAttribute('aria-disabled', String(!count));
    });

    qsa(document, `textarea${sel('cart-note')},input${sel('cart-note')}`).forEach((el) => {
      if (document.activeElement !== el) el.value = cart?.note || '';
    });

    qsa(document, sel('cart-discounts')).forEach((container) => {
      repeat(container, cart?.discountCodes || [], (node, d) => {
        node.setAttribute(attr('discount-code'), d.code);
        const t = node.querySelector(sel('discount', 'code')) || (node.firstElementChild ? null : node);
        if (t) setText(t, d.code);
        node.classList.toggle('is-inapplicable', !d.applicable);
      });
    });

    qsa(document, sel('cart-lines')).forEach((container) => {
      repeatKeyed(container, this.lines, (l) => l.id, (node, line) => renderLine(node, line), {
        onEnter: cfg.onLineEnter, onLeave: cfg.onLineLeave,
      });
    });

    if (cart) notifyLayoutChanged('cart');
  },
};

function lineValue(line, key) {
  const m = line.merchandise || {};
  const plan = line.sellingPlanAllocation?.sellingPlan;
  switch (key) {
    case 'title': return m.product?.title;
    case 'product-title': return m.product?.title;
    case 'variant-title': return m.title === 'Default Title' ? '' : m.title;
    case 'options': return (m.selectedOptions || [])
      .filter((o) => o.value !== 'Default Title').map((o) => `${o.name}: ${o.value}`).join(', ');
    case 'vendor': return m.product?.vendor;
    case 'sku': return m.sku;
    case 'price': return formatMoney(line.cost?.amountPerQuantity || m.price);
    case 'compare-at-price': return formatMoney(line.cost?.compareAtAmountPerQuantity || m.compareAtPrice);
    case 'line-total': return formatMoney(line.cost?.totalAmount);
    case 'line-subtotal': return formatMoney(line.cost?.subtotalAmount);
    case 'quantity': return Cart.quantityOf(line);
    case 'plan': return plan?.name || '';
    case 'plan-description': return plan?.description || '';
    case 'components': return (line.lineComponents || [])
      .map((c) => `${c.quantity} × ${c.merchandise?.product?.title || ''}`).join(', ');
    default:
      if (key.startsWith('attribute:')) {
        const k = key.slice('attribute:'.length);
        return (line.attributes || []).find((a) => a.key === k)?.value || '';
      }
      return undefined;
  }
}

function renderLine(node, line) {
  const m = line.merchandise || {};
  const isSub = Boolean(line.sellingPlanAllocation);
  node.setAttribute(attr('line-id'), line.id);
  node.classList.toggle('is-subscription', isSub);

  qsa(node, sel('line')).forEach((el) => {
    const key = get(el, 'line');
    if (key === 'image') return setImage(el, m.image?.url || m.product?.featuredImage?.url, m.product?.title);
    if (key === 'url') {
      const u = productUrl(m.product?.handle, m.product?.id);
      const q = new URLSearchParams();
      if (m.id) q.set('variant', String(m.id).split('/').pop());
      const plan = line.sellingPlanAllocation?.sellingPlan?.id;
      if (plan) q.set('selling_plan', plan.split('/').pop());
      const qs = q.toString();
      return el.setAttribute('href', qs ? `${u}${u.includes('?') ? '&' : '?'}${qs}` : u);
    }
    const v = lineValue(line, key);
    if (v !== undefined) setTextTracked(el, v);
    return undefined;
  });

  // Shopify's note about this line (e.g. less stock than asked): class is-warning, tether-line="warning".
  const warning = Cart.warnings.find((w) => w.target === line.id);
  node.classList.toggle('is-warning', Boolean(warning));
  const pending = Cart.pendingQty.has(line.id);
  node.classList.toggle('is-busy', pending);
  if (pending) node.setAttribute('aria-busy', 'true'); else node.removeAttribute('aria-busy');
  qsa(node, sel('line', 'warning')).forEach((el) => setTextTracked(el, warning?.message || ''));
  const lineConds = {
    subscription: isSub,
    'one-time': !isSub,
    'on-sale': parseFloat(line.cost?.compareAtAmountPerQuantity?.amount) > parseFloat(line.cost?.amountPerQuantity?.amount),
    'has-components': (line.lineComponents || []).length > 0,
    warning: Boolean(warning),
  };
  qsa(node, sel('line-show')).forEach((el) => {
    const k = get(el, 'line-show');
    if (k in lineConds) show(el, lineConds[k]);
  });

  // Change frequency in the cart: <select tether-line-plan> lists the product's plans.
  qsa(node, `select${sel('line-plan')}`).forEach((select) => {
    const handle = m.product?.handle;
    if (!handle) return;
    getProduct(handle).then((product) => {
      const plans = allPlans(product);
      const allowOneTime = !product.requiresSellingPlan && get(select, 'line-plan') !== 'subscription-only';
      const want = [
        ...(allowOneTime ? [{ value: '', label: select.getAttribute(attr('one-time-label')) || 'One-time purchase' }] : []),
        ...plans.map((p) => ({ value: p.id, label: p.name })),
      ];
      const sig = want.map((w) => w.value).join('|');
      if (select.dataset.tetherSig !== sig) {
        select.innerHTML = '';
        want.forEach((w) => {
          const o = document.createElement('option');
          o.value = w.value; o.textContent = w.label;
          select.appendChild(o);
        });
        select.dataset.tetherSig = sig;
      }
      select.value = line.sellingPlanAllocation?.sellingPlan?.id || '';
      show(select, plans.length > 0);
    }).catch((err) => reportError(err, 'line plan options'));
  });
}

