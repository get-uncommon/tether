/**
 * ProductScope: everything inside [tether-product="<handle>"] binds to one
 * Shopify product: options, variants, quantity, subscriptions, add to cart.
 */
import { cfg, reportError } from './config.js';
import {
  attr, sel, get, has, qsa, scoped, emit, formatMoney, formatDate, setText, setImage, show,
  setSelected, repeat, productUrl, notifyLayoutChanged, watchImages, busy, parseJSONAttr, toAttributes, sameImage, hasTemplate, formatPercent,
} from './dom.js';
import { Cart } from './cart.js';
import { STATUS_KEYS, ownedBy } from './status.js';
import {
  allPlans, allocationFor, planPrice, planCheckoutCharge, planSavings, planAdjustment, findPlan, GID,
} from './selling-plans.js';

export const scopes = new WeakMap(); // element -> ProductScope

const productSel = () => sel('product');

function metafieldValue(product, ref) {
  const i = ref.indexOf('.');
  const ns = ref.slice(0, i);
  const key = ref.slice(i + 1);
  const mf = (product.metafields || []).find((m) => m && m.namespace === ns && m.key === key);
  return mf || null;
}

// Option names as written in the markup (the build's language), by product handle. With another
// language Shopify translates them (Size -> Größe), so attributes are matched by position instead.
const knownOptionNames = new Map();
export function rememberOptionNames(products) {
  (products || []).forEach((p) => { if (p?.handle && !knownOptionNames.has(p.handle)) knownOptionNames.set(p.handle, (p.options || []).map((o) => o.name)); });
}

export class ProductScope {
  constructor(root, product) {
    this.root = root;
    this.product = product;
    this.selected = {};
    this.variant = null;
    this.quantity = Math.max(0, parseInt(get(root, 'quantity') ?? '1', 10) || (has(root, 'quantity') ? 0 : 1));
    this.plans = allPlans(product);
    this.purchase = 'one-time';
    this.planId = null;

    scopes.set(root, this);
    root.setAttribute(attr('state'), 'ready');
    root.removeAttribute(attr('error'));

    this.initSelection();
    this.initPurchase();
    this.renderProduct();
    this.bind();
    this.renderVariant();

    watchImages(root, 'product');
    notifyLayoutChanged('product');
    emit('product-ready', { product, scope: this }, root);
  }

  /** New data for the same product (e.g. after a country switch). Keeps the selection. */
  update(product) {
    const variantId = this.variant?.id;
    this.product = product;
    this.plans = allPlans(product);
    if (this.planId && !this.plans.some((p) => p.id === this.planId)) this.planId = this.plans[0]?.id || null;
    if (!this.plans.length && this.purchase === 'subscription') this.purchase = 'one-time';
    const v = product.variants.nodes.find((x) => x.id === variantId);
    if (v) { this.selected = {}; v.selectedOptions.forEach((o) => { this.selected[o.name] = o.value; }); }
    this.root.setAttribute(attr('state'), 'ready');
    this.root.removeAttribute(attr('error'));
    this.renderProduct();
    this.renderVariant();
    notifyLayoutChanged('product');
    emit('product-updated', { product, scope: this }, this.root);
  }

  /** Matching elements in this scope, including the root itself (e.g. a card link with tether-bind="link"). */
  $(s) {
    const inner = scoped(this.root, s, productSel());
    return this.root.matches(s) ? [this.root, ...inner] : inner;
  }

  // ------------------------------------------------------------ state

  /** The product's option name for a name used in the markup (same name, or same position). */
  optName(authored) {
    const opts = this.product?.options || [];
    if (!authored || opts.some((o) => o.name === authored)) return authored;
    const i = (knownOptionNames.get(this.product.handle) || []).indexOf(authored);
    return i >= 0 && opts[i] ? opts[i].name : authored;
  }

  initSelection() {
    const vs = this.product.variants.nodes;
    const first = vs.find((v) => v.availableForSale) || vs[0];
    if (first) first.selectedOptions.forEach((o) => { this.selected[o.name] = o.value; });

    const param = new URLSearchParams(window.location.search).get('variant') || get(this.root, 'variant');
    if (param) {
      const gid = GID.variant(param);
      const match = vs.find((v) => v.id === gid);
      if (match) {
        this.selected = {};
        match.selectedOptions.forEach((o) => { this.selected[o.name] = o.value; });
      }
    }
  }

  initPurchase() {
    if (!this.plans.length) return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = findPlan(this.product, params.get('selling_plan'));
    const fromAttr = findPlan(this.product, get(this.root, 'default-plan'));
    this.planId = (fromUrl || fromAttr || this.plans[0]).id;

    const wanted = fromUrl ? 'subscription' : (get(this.root, 'default-purchase') || cfg.defaultPurchase);
    this.purchase = this.product.requiresSellingPlan || wanted === 'subscription' ? 'subscription' : 'one-time';
  }

  findVariant() {
    return this.product.variants.nodes.find((v) =>
      v.selectedOptions.every((o) => this.selected[o.name] === o.value)) || null;
  }

  isValueAvailable(name, value) {
    return this.product.variants.nodes.some((v) =>
      v.availableForSale && v.selectedOptions.every((o) =>
        (o.name === name ? o.value === value : this.selected[o.name] === o.value)));
  }

  get plan() { return this.plans.find((p) => p.id === this.planId) || null; }

  /** True when the current variant can be bought on the selected plan. */
  get subscriptionAvailable() {
    return Boolean(this.variant && this.plans.some((p) => allocationFor(this.variant, p.id)));
  }

  get isSubscription() {
    return this.purchase === 'subscription' && Boolean(allocationFor(this.variant, this.planId));
  }

  /** What would be added to the cart right now. */
  getLine() {
    if (!this.variant) return null;
    const line = { merchandiseId: this.variant.id, quantity: this.quantity };
    if (this.isSubscription) line.sellingPlanId = this.planId;
    const attrs = this.collectAttributes();
    if (attrs.length) line.attributes = attrs;
    return line;
  }

  collectAttributes() {
    const fixed = toAttributes(parseJSONAttr(this.root, 'line-attributes'));
    const inputs = this.$(sel('line-attribute')).map((el) => {
      const key = get(el, 'line-attribute');
      let value;
      if (el.type === 'checkbox') value = el.checked ? (el.value && el.value !== 'on' ? el.value : 'Yes') : '';
      else if (el.type === 'radio') value = el.checked ? el.value : null;
      else value = el.value;
      return value == null || value === '' ? null : { key, value: String(value) };
    }).filter(Boolean);
    return [...fixed, ...inputs];
  }

  // ------------------------------------------------------------ actions

  select(name, value) {
    if (this.selected[name] === value) return;
    const vs = this.product.variants.nodes.filter((v) => v.selectedOptions.some((o) => o.name === name && o.value === value));
    if (!vs.length) return; // a value no variant has: nothing to select, keep the visitor's choice
    const next = { ...this.selected, [name]: value };
    if (!vs.some((v) => v.selectedOptions.every((o) => next[o.name] === o.value))) {
      // That combination doesn't exist: the closest variant with this value (most other choices kept, available first).
      const score = (v) => v.selectedOptions.filter((o) => o.name !== name && this.selected[o.name] === o.value).length * 2 + (v.availableForSale ? 1 : 0);
      const best = vs.reduce((a, b) => (score(b) > score(a) ? b : a));
      best.selectedOptions.forEach((o) => { next[o.name] = o.value; });
    }
    this.selected = next;
    this.renderVariant();
  }

  selectVariant(id) {
    const v = this.product.variants.nodes.find((x) => x.id === GID.variant(id));
    if (!v) return;
    this.selected = {};
    v.selectedOptions.forEach((o) => { this.selected[o.name] = o.value; });
    this.renderVariant();
  }

  setPurchase(mode) {
    const next = mode === 'subscription' ? 'subscription' : 'one-time';
    if (next === 'one-time' && this.product.requiresSellingPlan) return;
    if (this.purchase === next) return;
    this.purchase = next;
    this.renderVariant();
  }

  selectPlan(ref) {
    const p = findPlan(this.product, ref);
    if (!p) return;
    this.planId = p.id;
    this.purchase = 'subscription';
    this.renderVariant();
  }

  setQuantity(n) {
    const min = has(this.root, 'quantity') ? 0 : 1;
    this.quantity = Math.max(min, parseInt(n, 10) || 0);
    this.$(sel('qty')).forEach((i) => setText(i, this.quantity));
    this.renderVariant();
  }

  async addToCart() {
    if (!this.variant?.availableForSale) return null;
    const line = this.getLine();
    if (!line || line.quantity < 1) return null;
    const cart = await Cart.add(line);
    emit('product-added', { product: this.product, variant: this.variant, line }, this.root);
    return cart;
  }

  // ------------------------------------------------------------ events

  bind() {
    const own = (el) => el && el.closest(productSel()) === this.root;

    this.root.addEventListener('click', (e) => {
      const t = e.target;
      if (!t?.closest) return;

      const opt = t.closest(sel('option-value'));
      if (own(opt) && opt.closest(sel('option-list'))) {
        e.preventDefault();
        this.select(this.optName(get(opt.closest(sel('option-list')), 'option-list')), get(opt, 'option-value'));
        return;
      }

      const plan = t.closest(sel('plan-value'));
      if (own(plan)) { e.preventDefault(); this.selectPlan(get(plan, 'plan-value')); return; }

      const purchase = t.closest(`${sel('purchase')}:not(select)`);
      if (own(purchase)) {
        if (purchase.tagName !== 'INPUT') e.preventDefault();
        this.setPurchase(get(purchase, 'purchase'));
        return;
      }

      const plus = t.closest(sel('qty-plus'));
      if (own(plus)) { e.preventDefault(); this.setQuantity(this.quantity + 1); return; }
      const minus = t.closest(sel('qty-minus'));
      if (own(minus)) { e.preventDefault(); this.setQuantity(this.quantity - 1); return; }

      const add = t.closest(sel('add-to-cart'));
      if (own(add)) { e.preventDefault(); this.onAddClick(add); }
    });

    this.root.addEventListener('change', (e) => {
      const t = e.target;
      if (!own(t)) return;
      if (t.matches(`select${sel('option')}`)) this.select(this.optName(get(t, 'option')), t.value);
      else if (t.matches(`select${sel('variant-select')}`)) this.selectVariant(t.value);
      else if (t.matches(`select${sel('plan')}`)) {
        if (t.value) this.selectPlan(t.value); else this.setPurchase('one-time');
      } else if (t.matches(`select${sel('purchase')}`)) this.setPurchase(t.value);
      else if (t.matches(sel('qty'))) this.setQuantity(t.value);
    });
  }

  onAddClick(btn) {
    const label = btn.querySelector(sel('add-label')) || btn;
    const busyText = get(btn, 'adding-text');
    const write = (txt) => setText(label, txt);
    if (label.dataset.tetherLabel === undefined) label.dataset.tetherLabel = label.tagName === 'INPUT' ? label.value : label.textContent;

    busy(btn, async () => {
      if (busyText) write(busyText);
      try { await this.addToCart(); } catch (err) {
        reportError(err, 'add to cart failed');
        emit('error', { error: err, context: 'add-to-cart' }, this.root);
      } finally {
        if (busyText) write(label.dataset.tetherLabel);
      }
    }).then(() => {
      // Restore mode-dependent labels (subscribe-text / soldout-text) after aria-busy is cleared.
      this.renderVariant();
    });
  }

  // ------------------------------------------------------------ render

  renderProduct() {
    const p0 = this.product;
    if (!knownOptionNames.has(p0.handle)) {
      const authored = this.$(`${sel('option-list')},select${sel('option')}`).map((e) => get(e, 'option-list') || get(e, 'option'));
      if (authored.some((n) => p0.options.some((o) => o.name === n))) rememberOptionNames([p0]);
    }
    const p = this.product;

    this.$(sel('bind')).forEach((el) => {
      const key = get(el, 'bind') || '';
      const txt = {
        title: p.title,
        'description-text': p.description,
        vendor: p.vendor,
        type: p.productType,
        handle: p.handle,
      }[key];
      if (txt !== undefined) return setText(el, txt);
      switch (key) {
        case 'description': el.innerHTML = p.descriptionHtml || ''; return undefined;
        case 'published-at': return setText(el, formatDate(p.publishedAt));
        case 'min-price': return setText(el, formatMoney(p.priceRange.minVariantPrice));
        case 'max-price': return setText(el, formatMoney(p.priceRange.maxVariantPrice));
        case 'featured-image': return setImage(el, p.featuredImage?.url, p.featuredImage?.altText || p.title);
        case 'url':
        case 'link':
          el.setAttribute('href', productUrl(p.handle, p.id));
          if (key === 'url' && !el.firstElementChild && !el.textContent.trim()) setText(el, p.title);
          return undefined;
        case 'images': {
          // Server-rendered gallery with the same images: keep it as it is.
          const imgs = [...el.children].map((n) => (n.tagName === 'IMG' ? n : n.querySelector('img')));
          if (!hasTemplate(el) && imgs.length === p.images.nodes.length && imgs.every((im, i) => sameImage(im?.getAttribute('src'), p.images.nodes[i].url))) return undefined;
        }
          return repeat(el, p.images.nodes, (node, img) => {
            const target = node.matches(`img,${sel('bind', 'image')}`) ? node : node.querySelector('img') || node;
            setImage(target, img.url, img.altText || p.title);
          });
        case 'tags': {
          const exclude = (el.getAttribute('exclude') || '').split(',').map((s) => s.trim()).filter(Boolean);
          return repeat(el, p.tags.filter((t) => !exclude.includes(t)), (node, tag) => setText(node, tag));
        }
        default:
          // image:2 = the second product image (falls back to the featured image)
          if (/^image:\d+$/.test(key)) {
            const img = p.images.nodes[key.slice(6) - 1] || p.featuredImage;
            return setImage(el, img?.url, img?.altText || p.title);
          }
          if (key.startsWith('metafield:')) {
            const mf = metafieldValue(p, key.slice(10));
            if (!mf) return setText(el, '');
            if (mf.reference?.image) return setImage(el, mf.reference.image.url, mf.reference.image.altText);
            if (/^(rich_text|multi_line_text)_field$/.test(mf.type)) el.style.whiteSpace = 'pre-line';
            return setText(el, mf.value);
          }
          return undefined;
      }
    });

    this.$(sel('option-list')).forEach((container) => {
      const name = this.optName(get(container, 'option-list'));
      const opt = p.options.find((o) => o.name === name);
      if (!opt || (opt.optionValues.length <= 1 && has(container, 'hide-single'))) return show(container, false);
      return repeat(container, opt.optionValues, (node, v) => {
        node.setAttribute(attr('option-value'), v.name);
        const t = node.querySelector(sel('bind', 'option-value'));
        if (t) setText(t, v.name); else if (!node.firstElementChild) setText(node, v.name);
        const sw = node.querySelector(sel('bind', 'swatch'));
        if (sw && v.swatch?.color) sw.style.backgroundColor = v.swatch.color;
        if (sw && v.swatch?.image?.previewImage) setImage(sw, v.swatch.image.previewImage.url, v.name);
      });
    });

    this.$(`select${sel('option')}`).forEach((s) => {
      const opt = p.options.find((o) => o.name === this.optName(get(s, 'option')));
      if (!opt) return show(s, false);
      s.innerHTML = '';
      opt.optionValues.forEach((v) => s.appendChild(new Option(v.name, v.name)));
      return undefined;
    });

    this.$(`select${sel('variant-select')}`).forEach((s) => {
      s.innerHTML = '';
      p.variants.nodes.forEach((v) => s.appendChild(new Option(v.title, v.id)));
    });

    // Subscriptions
    this.$(sel('plan-list')).forEach((container) => {
      // Value = selling plan group name. Empty, "true", "all" or "*" = every plan
      // (Webflow's Designer doesn't always allow empty attribute values).
      const raw = (get(container, 'plan-list') || '').trim();
      const group = ['', 'true', 'all', '*'].includes(raw.toLowerCase()) ? null : raw;
      const plans = this.plans.filter((pl) => !group || pl.group.name === group);
      repeat(container, plans, (node, plan) => {
        node.setAttribute(attr('plan-value'), plan.id);
        if (!node.firstElementChild && !node.querySelector(sel('plan-bind'))) setText(node, plan.name);
      });
    });

    this.$(`select${sel('plan')}`).forEach((s) => {
      s.innerHTML = '';
      if (!p.requiresSellingPlan && get(s, 'plan') !== 'subscription-only') {
        s.appendChild(new Option(s.getAttribute(attr('one-time-label')) || 'One-time purchase', ''));
      }
      this.plans.forEach((pl) => s.appendChild(new Option(pl.name, pl.id)));
    });
  }

  renderVariant() {
    const p = this.product;
    let v = this.findVariant();
    if (!v) {
      [v] = p.variants.nodes;
      if (v) {
        this.selected = {};
        v.selectedOptions.forEach((o) => { this.selected[o.name] = o.value; });
      }
    }
    this.variant = v;
    if (!v) return;

    // A plan the variant isn't in -> pick the first one it is in.
    if (this.plans.length && !allocationFor(v, this.planId)) {
      const alt = this.plans.find((pl) => allocationFor(v, pl.id));
      if (alt) this.planId = alt.id;
    }

    const sub = this.isSubscription;
    const oneTimePrice = v.price;
    const subPrice = this.planId ? planPrice(v, this.planId) : null;
    const price = sub ? subPrice : oneTimePrice;
    const compareAt = sub ? (allocationFor(v, this.planId)?.priceAdjustments?.[0]?.compareAtPrice || v.compareAtPrice) : v.compareAtPrice;
    const onSale = compareAt && parseFloat(compareAt.amount) > parseFloat(price.amount);
    const discountPct = onSale ? Math.round((1 - parseFloat(price.amount) / parseFloat(compareAt.amount)) * 100) : 0;
    const savings = this.planId ? planSavings(v, this.planId) : { amount: null, percentage: 0 };
    const plan = this.plan;
    const total = { amount: (parseFloat(price.amount) * Math.max(1, this.quantity)).toFixed(2), currencyCode: price.currencyCode };

    const fm = formatMoney;
    const pct = (n) => formatPercent(n);
    // Text binds: name -> value (functions, so only the binds on the page are computed).
    const text = {
      price: () => fm(price),
      'total-price': () => fm(total),
      'one-time-price': () => fm(oneTimePrice),
      'subscription-price': () => fm(subPrice),
      'subscription-savings': () => pct(savings.percentage),
      'subscription-savings-amount': () => fm(savings.amount),
      // What the visitor pays today for the chosen quantity (prepaid plans charge more up front).
      'checkout-charge': () => { const c = sub ? planCheckoutCharge(v, this.planId) : price; return c && fm({ amount: (parseFloat(c.amount) * Math.max(1, this.quantity)).toFixed(2), currencyCode: c.currencyCode }); },
      'plan-name': () => plan?.name,
      'plan-description': () => plan?.description,
      'plan-group': () => plan?.group?.name,
      'compare-at-price': () => (onSale ? fm(compareAt) : ''),
      'unit-price': () => fm(v.unitPrice),
      'discount-percentage': () => `${discountPct}%`,
      'discount-amount': () => (onSale ? fm({ amount: String(parseFloat(compareAt.amount) - parseFloat(price.amount)), currencyCode: price.currencyCode }) : ''),
      'variant-title': () => v.title,
      'variant-id': () => v.id,
      sku: () => v.sku,
      barcode: () => v.barcode,
      stock: () => v.quantityAvailable,
      quantity: () => this.quantity,
    };
    this.$(sel('bind')).forEach((el) => {
      const k = get(el, 'bind');
      if (k === 'variant-image') setImage(el, v.image?.url || p.featuredImage?.url, v.image?.altText || p.title);
      else if (text[k]) setText(el, text[k]());
    });

    this.$(sel('option-selected')).forEach((el) => setText(el, this.selected[this.optName(get(el, 'option-selected'))] || ''));

    this.$(sel('option-list')).forEach((container) => {
      const name = this.optName(get(container, 'option-list'));
      qsa(container, sel('option-value')).forEach((node) => {
        const value = get(node, 'option-value');
        setSelected(node, this.selected[name] === value);
        const unavailable = !this.isValueAvailable(name, value);
        node.classList.toggle('is-unavailable', unavailable);
        node.setAttribute('data-unavailable', unavailable ? 'true' : 'false');
      });
    });

    this.$(`select${sel('option')}`).forEach((s) => { s.value = this.selected[this.optName(get(s, 'option'))] || ''; });
    this.$(`select${sel('variant-select')}`).forEach((s) => { s.value = v.id; });

    // Subscription UI
    this.$(sel('purchase')).forEach((el) => {
      if (el.tagName === 'SELECT') { el.value = this.purchase; return; }
      const mode = get(el, 'purchase');
      setSelected(el, mode === this.purchase);
      const unavailable = mode === 'subscription' ? !this.subscriptionAvailable : p.requiresSellingPlan;
      el.classList.toggle('is-unavailable', unavailable);
    });

    this.$(sel('plan-value')).forEach((node) => {
      const id = get(node, 'plan-value');
      const planObj = this.plans.find((pl) => pl.id === id);
      const inVariant = Boolean(allocationFor(v, id));
      setSelected(node, sub && id === this.planId);
      node.classList.toggle('is-unavailable', !inVariant);
      qsa(node, sel('plan-bind')).forEach((el) => {
        const adj = planAdjustment(planObj);
        const s = planSavings(v, id);
        const k = get(el, 'plan-bind');
        const val = {
          name: () => planObj?.name,
          option: () => (planObj?.options || []).map((o) => o.value).join(', '), // e.g. "1 month", without the store's price text
          description: () => planObj?.description,
          price: () => fm(planPrice(v, id)),
          savings: () => pct(s.percentage),
          'savings-amount': () => fm(s.amount),
          adjustment: () => (!adj ? '' : adj.type === 'percentage' ? `${adj.value}%` : fm(adj.value)),
        }[k];
        if (val) setText(el, val());
      });
    });

    this.$(`select${sel('plan')}`).forEach((s) => { s.value = sub ? this.planId : ''; });

    const low = v.quantityAvailable != null && v.quantityAvailable > 0 && v.quantityAvailable <= (cfg.lowStock ?? 5);
    const conds = {
      'in-stock': v.availableForSale,
      'out-of-stock': !v.availableForSale,
      'backorder': v.availableForSale && v.currentlyNotInStock,
      'on-sale': Boolean(onSale),
      'not-on-sale': !onSale,
      'has-variants': p.variants.nodes.length > 1,
      'single-variant': p.variants.nodes.length === 1,
      'low-stock': low,
      'plenty-in-stock': v.availableForSale && !low,
      'subscription-available': this.subscriptionAvailable,
      'subscription-unavailable': !this.subscriptionAvailable,
      'subscription-only': Boolean(p.requiresSellingPlan),
      'one-time-available': !p.requiresSellingPlan,
      'subscription-selected': sub,
      'one-time-selected': !sub,
      'has-savings': sub ? savings.percentage > 0 : Boolean(onSale),
      // scope state (see status.js)
      'loading': false,
      'ready': true,
      'error': false,
      'not-found': false,
    };
    this.$(sel('show')).forEach((el) => {
      const k = get(el, 'show');
      if (!(k in conds)) return;
      // State blocks of a list nested in this product belong to that list.
      if (STATUS_KEYS.includes(k) && !ownedBy(el, this.root)) return;
      show(el, conds[k]);
    });

    this.root.classList.toggle('is-subscription', sub);
    this.root.setAttribute(attr('purchase-mode'), sub ? 'subscription' : 'one-time');

    this.$(sel('add-to-cart')).forEach((btn) => {
      const disabled = !v.availableForSale;
      btn.classList.toggle('is-disabled', disabled);
      btn.setAttribute('aria-disabled', String(disabled));
      if ('disabled' in btn) btn.disabled = disabled;
      const soldOut = get(btn, 'soldout-text');
      const subText = get(btn, 'subscribe-text');
      if (soldOut || subText) {
        const label = btn.querySelector(sel('add-label')) || btn;
        if (label.dataset.tetherLabel === undefined) label.dataset.tetherLabel = label.tagName === 'INPUT' ? label.value : label.textContent;
        let text = label.dataset.tetherLabel;
        if (sub && subText) text = subText;
        if (disabled && soldOut) text = soldOut;
        if (btn.getAttribute('aria-busy') !== 'true') setText(label, text);
      }
    });

    emit('variant-changed', {
      product: p, variant: v, selected: { ...this.selected },
      purchase: this.purchase, sellingPlanId: sub ? this.planId : null,
    }, this.root);

    // Shareable links: the visitor's choice in ?variant= (variantUrl: true, for the page's main product,
    // or tether-variant-url on a scope). Only after a change, never on the first render.
    const key = `${v.id}|${sub ? this.planId : ''}`;
    if (this.urlKey && this.urlKey !== key && (has(this.root, 'variant-url') || (cfg.variantUrl && document.querySelector(productSel()) === this.root))) {
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('variant', v.id.split('/').pop());
        if (sub) u.searchParams.set('selling_plan', this.planId.split('/').pop()); else u.searchParams.delete('selling_plan');
        window.history.replaceState(window.history.state, '', u);
      } catch { /* ignore */ }
    }
    this.urlKey = key;
  }
}
