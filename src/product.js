/**
 * ProductScope: everything inside [tether-product="<handle>"] binds to one
 * Shopify product: options, variants, quantity, subscriptions, add to cart.
 */
import { cfg, reportError } from './config.js';
import {
  attr, sel, get, has, qsa, scoped, emit, formatMoney, formatDate, setText, setImage, show,
  setSelected, repeat, productUrl, notifyLayoutChanged, watchImages, busy, parseJSONAttr, toAttributes,
} from './dom.js';
import { Cart } from './cart.js';
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

    this.initSelection();
    this.initPurchase();
    this.renderProduct();
    this.bind();
    this.renderVariant();

    watchImages(root, 'product');
    notifyLayoutChanged('product');
    emit('product-ready', { product, scope: this }, root);
  }

  $(s) { return scoped(this.root, s, productSel()); }

  // ------------------------------------------------------------ state

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
    this.selected[name] = value;
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
        this.select(get(opt.closest(sel('option-list')), 'option-list'), get(opt, 'option-value'));
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
      if (t.matches(`select${sel('option')}`)) this.select(get(t, 'option'), t.value);
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
    const p = this.product;

    this.$(sel('bind')).forEach((el) => {
      const key = get(el, 'bind');
      switch (key) {
        case 'title': return setText(el, p.title);
        case 'description': el.innerHTML = p.descriptionHtml || ''; return undefined;
        case 'description-text': return setText(el, p.description);
        case 'vendor': return setText(el, p.vendor);
        case 'type': return setText(el, p.productType);
        case 'handle': return setText(el, p.handle);
        case 'published-at': return setText(el, formatDate(p.publishedAt));
        case 'min-price': return setText(el, formatMoney(p.priceRange.minVariantPrice));
        case 'max-price': return setText(el, formatMoney(p.priceRange.maxVariantPrice));
        case 'featured-image': return setImage(el, p.featuredImage?.url, p.featuredImage?.altText || p.title);
        case 'url':
        case 'link':
          el.setAttribute('href', productUrl(p.handle));
          if (key === 'url' && !el.firstElementChild && !el.textContent.trim()) setText(el, p.title);
          return undefined;
        case 'images':
          return repeat(el, p.images.nodes, (node, img) => {
            const target = node.matches(`img,${sel('bind', 'image')}`) ? node : node.querySelector('img') || node;
            setImage(target, img.url, img.altText || p.title);
          });
        case 'tags': {
          const exclude = (el.getAttribute('exclude') || '').split(',').map((s) => s.trim()).filter(Boolean);
          return repeat(el, p.tags.filter((t) => !exclude.includes(t)), (node, tag) => setText(node, tag));
        }
        default:
          if (key && key.startsWith('metafield:')) {
            const mf = metafieldValue(p, key.slice('metafield:'.length));
            if (!mf) return setText(el, '');
            if (mf.reference?.image) return setImage(el, mf.reference.image.url, mf.reference.image.altText);
            if (mf.type === 'rich_text_field' || mf.type === 'multi_line_text_field') {
              el.textContent = mf.value; el.style.whiteSpace = 'pre-line'; return undefined;
            }
            return setText(el, mf.value);
          }
          return undefined;
      }
    });

    this.$(sel('option-list')).forEach((container) => {
      const name = get(container, 'option-list');
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
      const opt = p.options.find((o) => o.name === get(s, 'option'));
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
      const group = get(container, 'plan-list');
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

    this.$(sel('bind')).forEach((el) => {
      switch (get(el, 'bind')) {
        case 'price': return setText(el, formatMoney(price));
        case 'total-price': return setText(el, formatMoney(total));
        case 'one-time-price': return setText(el, formatMoney(oneTimePrice));
        case 'subscription-price': return setText(el, formatMoney(subPrice));
        case 'subscription-savings': return setText(el, savings.percentage ? `${savings.percentage}%` : '');
        case 'subscription-savings-amount': return setText(el, formatMoney(savings.amount));
        case 'checkout-charge': return setText(el, formatMoney(sub ? planCheckoutCharge(v, this.planId) : price));
        case 'plan-name': return setText(el, plan?.name || '');
        case 'plan-description': return setText(el, plan?.description || '');
        case 'plan-group': return setText(el, plan?.group?.name || '');
        case 'compare-at-price': return setText(el, onSale ? formatMoney(compareAt) : '');
        case 'unit-price': return setText(el, formatMoney(v.unitPrice));
        case 'discount-percentage': return setText(el, `${discountPct}%`);
        case 'discount-amount':
          return setText(el, onSale ? formatMoney({
            amount: String(parseFloat(compareAt.amount) - parseFloat(price.amount)),
            currencyCode: price.currencyCode,
          }) : '');
        case 'variant-title': return setText(el, v.title);
        case 'variant-id': return setText(el, v.id);
        case 'sku': return setText(el, v.sku);
        case 'barcode': return setText(el, v.barcode);
        case 'stock': return setText(el, v.quantityAvailable ?? '');
        case 'quantity': return setText(el, this.quantity);
        case 'variant-image': return setImage(el, v.image?.url || p.featuredImage?.url, v.image?.altText || p.title);
        default: return undefined;
      }
    });

    this.$(sel('option-selected')).forEach((el) => setText(el, this.selected[get(el, 'option-selected')] || ''));

    this.$(sel('option-list')).forEach((container) => {
      const name = get(container, 'option-list');
      qsa(container, sel('option-value')).forEach((node) => {
        const value = get(node, 'option-value');
        setSelected(node, this.selected[name] === value);
        const unavailable = !this.isValueAvailable(name, value);
        node.classList.toggle('is-unavailable', unavailable);
        node.setAttribute('data-unavailable', unavailable ? 'true' : 'false');
      });
    });

    this.$(`select${sel('option')}`).forEach((s) => { s.value = this.selected[get(s, 'option')] || ''; });
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
        switch (get(el, 'plan-bind')) {
          case 'name': return setText(el, planObj?.name);
          case 'description': return setText(el, planObj?.description || '');
          case 'price': return setText(el, formatMoney(planPrice(v, id)));
          case 'savings': return setText(el, s.percentage ? `${s.percentage}%` : '');
          case 'savings-amount': return setText(el, formatMoney(s.amount));
          case 'adjustment':
            if (!adj) return setText(el, '');
            return setText(el, adj.type === 'percentage' ? `${adj.value}%` : formatMoney(adj.value));
          default: return undefined;
        }
      });
    });

    this.$(`select${sel('plan')}`).forEach((s) => { s.value = sub ? this.planId : ''; });

    const conds = {
      'in-stock': v.availableForSale,
      'out-of-stock': !v.availableForSale,
      'backorder': v.availableForSale && v.currentlyNotInStock,
      'on-sale': Boolean(onSale),
      'not-on-sale': !onSale,
      'has-variants': p.variants.nodes.length > 1,
      'single-variant': p.variants.nodes.length === 1,
      'low-stock': v.quantityAvailable != null && v.quantityAvailable > 0 && v.quantityAvailable <= 5,
      'subscription-available': this.subscriptionAvailable,
      'subscription-unavailable': !this.subscriptionAvailable,
      'subscription-only': Boolean(p.requiresSellingPlan),
      'one-time-available': !p.requiresSellingPlan,
      'subscription-selected': sub,
      'one-time-selected': !sub,
      'has-savings': sub ? savings.percentage > 0 : Boolean(onSale),
    };
    this.$(sel('show')).forEach((el) => {
      const k = get(el, 'show');
      if (k in conds) show(el, conds[k]);
    });

    this.root.classList.toggle('is-subscription', sub);
    this.root.setAttribute(attr('purchase-mode'), sub ? 'subscription' : 'one-time');

    this.$(sel('add-to-cart')).forEach((btn) => {
      const disabled = !v.availableForSale;
      btn.classList.toggle('is-disabled', disabled);
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
  }
}
