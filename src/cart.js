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
  ${name}(${inner}) { cart { ...TetherCart } userErrors { field message } }
}
${cartFragment()}`;
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
    this.render();
    emit('cart-updated', { cart, reason });
    return cart;
  },

  async init() {
    const id = this.id();
    if (!id) { this.state = null; this.render(); return null; }
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
    this.render();
    return this.state;
  },

  async _create(input = {}) {
    const buyerIdentity = cfg.country ? { countryCode: String(cfg.country).toUpperCase() } : undefined;
    const data = await gql(
      mutation('cartCreate', '$input: CartInput!', 'input: $input'),
      { input: { buyerIdentity, ...input } },
    );
    return unwrap(data.cartCreate, 'cartCreate').cart;
  },

  /** Runs a cart mutation; creates a fresh cart if ours expired. */
  async _mutate(name, args, inner, variables, createInput) {
    const cartId = this.id();
    if (!cartId) return createInput ? this._create(createInput) : null;
    try {
      const data = await gql(mutation(name, `$cartId: ID!, ${args}`, `cartId: $cartId, ${inner}`), { ...variables, cartId });
      return unwrap(data[name], name).cart;
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
    const merged = new Map((this.state?.attributes || []).map((a) => [a.key, a.value]));
    toAttributes(obj).forEach((a) => merged.set(a.key, a.value));
    const attributes = [...merged].filter(([, v]) => v !== '').map(([key, value]) => ({ key, value }));
    return this._queue(async () => this._commit(
      await this._mutate('cartAttributesUpdate', '$attributes: [AttributeInput!]!', 'attributes: $attributes', { attributes }, { attributes }),
      'attributes',
    ));
  },

  /** Replaces the discount codes. Pass [] to remove all. */
  setDiscountCodes(codes) {
    const discountCodes = (Array.isArray(codes) ? codes : [codes]).map((c) => String(c).trim()).filter(Boolean);
    return this._queue(async () => this._commit(
      await this._mutate('cartDiscountCodesUpdate', '$discountCodes: [String!]!', 'discountCodes: $discountCodes', { discountCodes }, { discountCodes }),
      'discount',
    ));
  },

  applyDiscount(code) {
    const current = (this.state?.discountCodes || []).map((d) => d.code);
    return this.setDiscountCodes([...new Set([...current, code])]);
  },

  removeDiscount(code) {
    return this.setDiscountCodes((this.state?.discountCodes || []).map((d) => d.code).filter((c) => c !== code));
  },

  /** { countryCode, email, phone } — changes currency/prices for that market. */
  setBuyerIdentity(buyerIdentity) {
    return this._queue(async () => this._commit(
      await this._mutate('cartBuyerIdentityUpdate', '$buyerIdentity: CartBuyerIdentityInput!', 'buyerIdentity: $buyerIdentity', { buyerIdentity }, { buyerIdentity }),
      'buyer-identity',
    ));
  },

  /**
   * Goes to Shopify checkout. With checkoutTarget '_blank' the tab is opened
   * inside the click (Safari blocks window.open after an await) and gets its
   * URL once we have it.
   */
  async checkout(target = cfg.checkoutTarget) {
    const id = this.id();
    if (!id) return null;
    const tab = target === '_blank' ? window.open('', '_blank') : null;
    if (tab) { try { tab.opener = null; } catch { /* ignore */ } }

    try {
      const data = await gql('query TetherCheckout($id: ID!) { cart(id: $id) { checkoutUrl } }', { id });
      const url = data.cart?.checkoutUrl;
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

  isOpen() { return this.drawers().some((d) => d.classList.contains(cfg.cartDrawerOpenClass)); },

  open() {
    if (this.isOpen()) return;
    const ds = this.drawers().filter((d) => get(d, 'cart-drawer') !== 'manual');
    ds.forEach((d) => { d.classList.add(cfg.cartDrawerOpenClass); d.setAttribute('aria-hidden', 'false'); });
    if (typeof cfg.onCartOpen === 'function') cfg.onCartOpen(ds);
    emit('cart-toggled', { open: true });
  },

  close() {
    if (!this.isOpen()) return;
    const ds = this.drawers();
    ds.forEach((d) => { d.classList.remove(cfg.cartDrawerOpenClass); d.setAttribute('aria-hidden', 'true'); });
    if (typeof cfg.onCartClose === 'function') cfg.onCartClose(ds);
    emit('cart-toggled', { open: false });
  },

  toggle() { if (this.isOpen()) this.close(); else this.open(); },

  // -------------------------------------------------------------- render

  render() {
    const cart = this.state;
    const count = cart ? cart.totalQuantity : 0;
    const money = (k) => (cart ? formatMoney(cart.cost?.[k]) : '');

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
    };
    qsa(document, sel('show')).forEach((el) => {
      const k = get(el, 'show');
      if (k in conds && !el.closest(sel('product'))) show(el, conds[k]);
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
    case 'quantity': return line.quantity;
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
    if (key === 'url') return el.setAttribute('href', productUrl(m.product?.handle, m.product?.id));
    const v = lineValue(line, key);
    if (v !== undefined) setTextTracked(el, v);
    return undefined;
  });

  const lineConds = {
    subscription: isSub,
    'one-time': !isSub,
    'on-sale': parseFloat(line.cost?.compareAtAmountPerQuantity?.amount) > parseFloat(line.cost?.amountPerQuantity?.amount),
    'has-components': (line.lineComponents || []).length > 0,
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

