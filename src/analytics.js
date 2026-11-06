// @ts-nocheck
/**
 * Analytics, as an optional part (loaded when config.analytics is set).
 *
 *   analytics: {
 *     dataLayer: true,        // GA4 / Google Tag Manager ecommerce events (window.dataLayer)
 *     shopify: true,          // Shopify's own analytics (experimental, see docs/analytics.md)
 *     onEvent(name, data) {}, // any other tool: Meta, TikTok, Plausible, …
 *   }
 *
 * Events: view_item (the page's product), view_item_list (lists), add_to_cart / remove_from_cart
 * (from the cart's changes, so quick +/- and JS calls count too), view_cart (cart opened),
 * begin_checkout, search (search as you type). Purchases happen on Shopify's checkout: use
 * Shopify's Google & YouTube app or a checkout pixel for those.
 *
 * Shopify analytics: Tether sets up the same event bus Hydrogen uses (window.Shopify.analytics) and
 * loads Shopify's consent script and shopify.js, which build and send the events. Nothing is sent
 * before the Customer Privacy API allows analytics.
 */
import { cfg, log, reportError } from './config.js';
import { gql } from './client.js';
import { sel } from './dom.js';
import { Cart } from './cart.js';

const num = (m) => (m ? parseFloat(m.amount) : 0);
const id = (gid) => String(gid || '').split('/').pop();

// ---------------------------------------------------------------- shapes

function itemFromVariant(p, v, quantity = 1, index) {
  return {
    item_id: v?.sku || id(v?.id) || id(p.id),
    item_name: p.title,
    item_variant: v?.title === 'Default Title' ? undefined : v?.title,
    item_brand: p.vendor || undefined,
    item_category: p.productType || undefined,
    price: num(v?.price || p.priceRange?.minVariantPrice),
    quantity,
    ...(index != null ? { index } : {}),
  };
}

function itemFromLine(l, quantity = l.quantity) {
  const m = l.merchandise || {};
  return itemFromVariant({ ...(m.product || {}), title: m.product?.title }, m, quantity);
}

const value = (items) => Math.round(items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0) * 100) / 100;

// ---------------------------------------------------------------- GA4 / GTM

function ga(event, ecommerce) {
  const name = typeof cfg.analytics.dataLayer === 'string' ? cfg.analytics.dataLayer : 'dataLayer';
  const dl = (window[name] = window[name] || []);
  if (ecommerce) dl.push({ ecommerce: null }); // Google: clear the previous ecommerce object first
  dl.push(ecommerce ? { event, ecommerce } : { event });
}

// ---------------------------------------------------------------- Shopify analytics (Hydrogen's bus)

let bus = null;

function shopifyBus(shopId) {
  const destinations = [];
  const buffer = [];
  const privacy = () => window.Shopify?.customerPrivacy;
  const canTrack = () => {
    try {
      const p = privacy();
      return p?.consentStatus === 'loaded' && p.currentVisitorConsent?.()?.analytics !== 'no' && Boolean(p.analyticsProcessingAllowed?.());
    } catch { return false; }
  };
  const config = { shop: { shopId, channel: 'headless' }, consent: { mode: cfg.analytics.shopify?.consent || 'no-banner' } };
  const deliver = () => {
    if (!canTrack()) return;
    destinations.forEach((d) => {
      while (d.next < buffer.length) {
        const { event, payload } = buffer[d.next++];
        (d.subs.get(event) || []).forEach((cb) => { try { cb(payload, d.context); } catch (err) { reportError(err, `analytics ${d.name}`); } });
      }
    });
  };
  const api = {
    getConfig: () => config,
    publish(event, payload = {}) {
      buffer.push({ event, payload: { shop: config.shop, url: window.location.href, ...payload } });
      if (buffer.length > 500) { buffer.shift(); destinations.forEach((d) => { d.next = Math.max(0, d.next - 1); }); }
      deliver();
    },
    addDestination(dest) {
      const tag = `hydrogen:${dest.name}`;
      const d = {
        name: dest.name, next: 0, subs: new Map(),
        context: {
          getTrackingValues: () => {
            const i = canTrack() ? privacy()?.__internal : null;
            return { uniqueToken: i?.uniqueToken?.({ generateFallback: true, tag }) ?? '', visitToken: i?.visitToken?.({ generateFallback: true, tag }) ?? '' };
          },
        },
      };
      const subscribe = (event, cb) => {
        if (!d.subs.has(event)) d.subs.set(event, new Set());
        d.subs.get(event).add(cb);
        return () => d.subs.get(event)?.delete(cb);
      };
      Promise.resolve(dest.setup?.({ subscribe, getConfig: api.getConfig })).then(() => { destinations.push(d); deliver(); })
        .catch((err) => reportError(err, `analytics ${dest.name}`));
      return () => { const i = destinations.indexOf(d); if (i >= 0) destinations.splice(i, 1); };
    },
  };
  document.addEventListener('consentTrackingApiLoaded', deliver);
  document.addEventListener('visitorConsentCollected', deliver);
  return api;
}

function loadScript(src) {
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  document.head.appendChild(s);
}

async function startShopify() {
  if (window.Shopify?.analytics) { bus = window.Shopify.analytics; return; } // already set up (e.g. by the theme)
  const data = await gql('query TetherShopId { shop { id } }', {}, { context: false });
  const country = String(cfg.country || 'US').toUpperCase();
  const S = (window.Shopify = window.Shopify || {});
  Object.assign(S, {
    country,
    locale: (cfg.locale || 'en').split('-')[0].toLowerCase(), // required by Shopify's script
    shop: cfg.domain,
    routes: { root: '/', match: () => ({ pageTemplateName: mainProduct() ? 'product' : 'page' }), ...(S.routes || {}) },
  });
  const proxy = cfg.analytics.shopify?.proxy; // same-origin Storefront API path, for exact visitor counts
  S.customerPrivacy = {
    ...(S.customerPrivacy || {}),
    config: proxy
      ? { isHeadless: true, asyncConsent: true, asyncVisitorState: true, consentDomain: window.location.host }
      : { isHeadless: true, storefrontAccessToken: cfg.token, checkoutRootDomain: cfg.domain },
  };
  bus = shopifyBus(data.shop.id);
  S.analytics = bus;
  loadScript(cfg.analytics.shopify?.consent === 'default-banner'
    ? 'https://cdn.shopify.com/shopifycloud/privacy-banner/storefront-banner.js'
    : 'https://cdn.shopify.com/shopifycloud/consent-tracking-api/v0.2/consent-tracking-api.js');
  loadScript('https://cdn.shopify.com/storefront/analytics/shopify.js');
  log('shopify analytics ready', data.shop.id);
}

const productPayload = (p, v, quantity = 1) => ({
  id: p.id, title: p.title, price: v.price, vendor: p.vendor || '', variantId: v.id, variantTitle: v.title,
  quantity, sku: v.sku || undefined, productType: p.productType || undefined,
});

function analyticsLine(l) {
  const m = l.merchandise || {};
  return { id: l.id, quantity: l.quantity, merchandise: { id: m.id, title: m.title, price: m.price, sku: m.sku, product: { id: m.product?.id, title: m.product?.title, vendor: m.product?.vendor || '', handle: m.product?.handle } } };
}

// ---------------------------------------------------------------- what happened on the page

function mainProduct() {
  const el = document.querySelector(sel('product'));
  return el && !el.closest(`${sel('collection')},${sel('products')},${sel('recommendations')}`) ? window.Tether?.getScope(el) : null;
}

const send = (name, data, shopifyEvent, shopifyPayload) => {
  if (cfg.analytics.dataLayer) ga(name, data);
  if (bus && shopifyEvent) bus.publish(shopifyEvent, shopifyPayload);
  try { cfg.analytics.onEvent?.(name, data); } catch (err) { reportError(err, 'analytics onEvent'); }
};

let lastLines = null; // variant id -> line, to turn cart changes into add/remove events
let viewed = new WeakSet();

function handle(e) {
  const name = e.type.slice(cfg.prefix.length + 1);
  const d = e.detail || {};
  if (name === 'product-ready') {
    const scope = d.scope;
    if (!scope || viewed.has(scope.root) || mainProduct() !== scope) return;
    viewed.add(scope.root);
    const v = scope.variant || d.product.variants.nodes[0];
    const items = [itemFromVariant(d.product, v)];
    send('view_item', { currency: v?.price?.currencyCode, value: value(items), items }, 'product_viewed', { products: [productPayload(d.product, v)] });
  } else if (name === 'list-ready') {
    const items = (d.products || []).slice(0, 200).map((p, i) => itemFromVariant(p, p.variants?.nodes?.[0], 1, i));
    const list = { item_list_id: d.collection?.handle || 'products', item_list_name: d.collection?.title || 'Products' };
    send('view_item_list', { ...list, items }, d.collection ? 'collection_viewed' : null, d.collection ? { collection: { id: d.collection.id, handle: d.collection.handle } } : null);
  } else if (name === 'cart-updated') {
    const cart = d.cart;
    const now = new Map((cart?.lines?.nodes || []).map((l) => [l.merchandise?.id, l]));
    if (lastLines && d.reason !== 'load' && d.reason !== 'pending') {
      const currency = cart?.cost?.totalAmount?.currencyCode;
      now.forEach((l, k) => {
        const diff = l.quantity - (lastLines.get(k)?.quantity || 0);
        if (diff > 0) {
          const items = [itemFromLine(l, diff)];
          send('add_to_cart', { currency, value: value(items), items }, 'product_added_to_cart', {
            cart, prevCart: lastCart, currentLine: analyticsLine(l), prevLine: lastLines.get(k) ? analyticsLine(lastLines.get(k)) : undefined,
          });
        }
      });
      lastLines.forEach((l, k) => {
        const diff = l.quantity - (now.get(k)?.quantity || 0);
        if (diff > 0) { const items = [itemFromLine(l, diff)]; send('remove_from_cart', { currency, value: value(items), items }); }
      });
    }
    lastLines = now;
    lastCart = cart;
  } else if (name === 'cart-toggled' && d.open) {
    const items = Cart.lines.map((l) => itemFromLine(l));
    send('view_cart', { currency: Cart.state?.cost?.totalAmount?.currencyCode, value: value(items), items });
  } else if (name === 'checkout') {
    const items = (d.cart?.lines?.nodes || []).map((l) => itemFromLine(l));
    const coupon = (d.cart?.discountCodes || []).filter((c) => c.applicable).map((c) => c.code).join(',') || undefined;
    send('begin_checkout', { currency: d.cart?.cost?.totalAmount?.currencyCode, value: value(items), coupon, items });
  } else if (name === 'search' && d.term) {
    send('search', { search_term: d.term }, 'search_viewed', { searchTerm: d.term });
  } else if (name === 'page') {
    viewed = new WeakSet();
    if (bus) bus.publish('page_viewed', {});
  }
}
let lastCart = null;

/** Called by the core with the events it buffered while this part loaded. */
export async function startAnalytics(queue) {
  if (cfg.analytics.shopify) await startShopify().catch((err) => reportError(err, 'shopify analytics'));
  if (bus) bus.publish('page_viewed', {});
  queue.splice(0).forEach(handle);
  queue.push = (e) => { handle(e); return 0; }; // from now on, handle events as they come
}
