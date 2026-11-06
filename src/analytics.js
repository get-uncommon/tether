/**
 * Analytics, as an optional part (loaded when config.analytics is set).
 *
 *   analytics: {
 *     dataLayer: true,        // GA4 / Google Tag Manager ecommerce events (window.dataLayer)
 *     shopify: true,          // Shopify's own analytics (experimental, see docs/analytics.md)
 *     onEvent(name, data) {}, // any other tool: Meta, TikTok, Plausible
 *   }
 *
 * Events: view_item (the page's product), view_item_list (lists), add_to_cart / remove_from_cart (from the cart's
 * changes, so quick +/- and JS calls count too), view_cart (cart opened), begin_checkout, search (search as you type).
 * Purchases happen on Shopify's checkout: use Shopify's Google & YouTube app or a checkout pixel for those.
 * Shopify's analytics are set up in analytics-shopify.js.
 */
import { cfg, reportError } from './config.js';
import { isOwnEvent, sel } from './dom.js';
import { Cart } from './cart.js';
import { scopes } from './product.js';
import { startShopifyAnalytics } from './analytics-shopify.js';
/** @import { Money } from './shopify-values.js' */
/** @import { Product, ProductVariant } from './fragments.js' */
/** @import { AnalyticsBus, EventPayload } from './analytics-shopify.js' */
/** @import { ProductScope } from './product.js' */

/**
 * cart.js has no types yet; these are the fields of its cart (`fragment TetherCart`) this module reads.
 *
 * @typedef {object} LineProduct
 * @property {string} id
 * @property {string} title
 * @property {string} handle
 * @property {string} vendor
 * @typedef {{ id: string, title: string, sku: string | null, price: Money, product: LineProduct }} LineVariant
 * @typedef {{ id: string, quantity: number, merchandise: LineVariant }} CartLine
 * @typedef {object} AnalyticsCart
 * @property {{ nodes: CartLine[] }} lines
 * @property {{ totalAmount: Money }} cost
 * @property {{ code: string, applicable: boolean }[]} discountCodes
 */

/**
 * @typedef {object} ItemProduct What a GA4 item is built from: a product, or a cart line's product.
 * @property {string} id
 * @property {string} title
 * @property {string} [vendor]
 * @property {string} [productType]
 * @property {{ minVariantPrice: Money }} [priceRange]
 */
/** @typedef {Pick<ProductVariant, 'id' | 'title' | 'sku' | 'price'>} ItemVariant */
/**
 * @typedef {object} AnalyticsItem A GA4 ecommerce item.
 * @property {string} item_id
 * @property {string} item_name
 * @property {string | undefined} item_variant
 * @property {string | undefined} item_brand
 * @property {string | undefined} item_category
 * @property {number} price
 * @property {number} quantity
 * @property {number} [index]
 */
/** @typedef {{ id: string, handle: string, title: string }} ListCollection */
/** @typedef {{ product: Product, scope: ProductScope | null }} ProductReadyDetail */
/** @typedef {{ products: Product[] | undefined, collection: ListCollection | null }} ListReadyDetail */
/** @typedef {{ cart: AnalyticsCart | null, reason: string }} CartUpdatedDetail */

/** Shopify's title for the one variant of a product without options. */
const DEFAULT_VARIANT_TITLE = 'Default Title';
const CENTS_PER_UNIT = 100;
/** GA4 drops an event with more items than this. */
const MAX_LIST_ITEMS = 200;

/** @param {Money | null | undefined} money */
const amountOf = (money) => (money ? parseFloat(money.amount) : 0);

/**
 * @param {string | null | undefined} gid
 * @returns {string} The numeric part of a gid.
 */
const numericId = (gid) => (gid ?? '').split('/').pop() ?? '';

/**
 * @param {ItemProduct} product
 * @param {ItemVariant | null | undefined} variant
 * @param {number} [quantity]
 * @param {number} [index] The position in a list.
 * @returns {AnalyticsItem}
 */
function itemFromVariant(product, variant, quantity = 1, index) {
  /** @type {AnalyticsItem} */
  const item = {
    item_id: variant?.sku || numericId(variant?.id) || numericId(product.id),
    item_name: product.title,
    item_variant: variant?.title === DEFAULT_VARIANT_TITLE ? undefined : variant?.title,
    item_brand: product.vendor || undefined,
    item_category: product.productType || undefined,
    price: amountOf(variant?.price ?? product.priceRange?.minVariantPrice),
    quantity,
  };
  if (index != null) item.index = index;
  return item;
}

/**
 * @param {CartLine} line
 * @param {number} [quantity]
 */
const itemFromLine = (line, quantity = line.quantity) =>
  itemFromVariant(line.merchandise.product, line.merchandise, quantity);

/**
 * @param {AnalyticsItem[]} items
 * @returns {number} The items' total, rounded to cents.
 */
function totalValue(items) {
  const total = items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);
  return Math.round(total * CENTS_PER_UNIT) / CENTS_PER_UNIT;
}

/**
 * @param {Product} product
 * @param {ItemVariant} variant
 * @param {number} [quantity]
 */
const productPayload = (product, variant, quantity = 1) => ({
  id: product.id,
  title: product.title,
  price: variant.price,
  vendor: product.vendor || '',
  variantId: variant.id,
  variantTitle: variant.title,
  quantity,
  sku: variant.sku || undefined,
  productType: product.productType || undefined,
});

/** @param {CartLine} line */
const linePayload = (line) => ({
  id: line.id,
  quantity: line.quantity,
  merchandise: {
    id: line.merchandise.id,
    title: line.merchandise.title,
    price: line.merchandise.price,
    sku: line.merchandise.sku,
    product: {
      id: line.merchandise.product.id,
      title: line.merchandise.product.title,
      vendor: line.merchandise.product.vendor || '',
      handle: line.merchandise.product.handle,
    },
  },
});

/** @returns {unknown[]} The GA4 / GTM data layer, created when the page has none. */
function dataLayer() {
  const { dataLayer: option } = cfg.analytics ?? {};
  const name = typeof option === 'string' ? option : 'dataLayer';
  /** @type {unknown} */
  const existing = Reflect.get(window, name);
  if (Array.isArray(existing)) return existing;
  /** @type {unknown[]} */
  const created = [];
  Reflect.set(window, name, created);
  return created;
}

/**
 * @param {string} event
 * @param {Record<string, unknown> | undefined} ecommerce
 */
function pushToDataLayer(event, ecommerce) {
  const layer = dataLayer();
  if (!ecommerce) {
    layer.push({ event });
    return;
  }
  // Google asks for the previous ecommerce object to be cleared first.
  layer.push({ ecommerce: null });
  layer.push({ event, ecommerce });
}

/** @type {AnalyticsBus | null} */
let bus = null;
/** @type {Map<string, CartLine> | null} Variant id to line, to turn cart changes into add and remove events. */
let lastLines = null;
/** @type {AnalyticsCart | null} */
let lastCart = null;
/** @type {WeakSet<Element>} Product roots whose view_item was sent on this page. */
let viewed = new WeakSet();

/**
 * @param {string} name The GA4 event.
 * @param {Record<string, unknown>} data
 * @param {string} [shopifyEvent]
 * @param {EventPayload} [shopifyPayload]
 */
function send(name, data, shopifyEvent, shopifyPayload) {
  if (cfg.analytics?.dataLayer) pushToDataLayer(name, data);
  if (bus && shopifyEvent) bus.publish(shopifyEvent, shopifyPayload);
  try {
    cfg.analytics?.onEvent?.(name, data);
  } catch (error) {
    reportError(error, 'analytics onEvent');
  }
}

/** @returns {ProductScope | null} The scope of the page's own product: a product root outside every list. */
function mainProduct() {
  const el = document.querySelector(sel('product'));
  if (!el || el.closest(`${sel('collection')},${sel('products')},${sel('recommendations')}`)) return null;
  return scopes.get(el) ?? null;
}

/** @param {ProductReadyDetail} detail */
function onProductReady({ product, scope }) {
  if (!scope || viewed.has(scope.root) || mainProduct() !== scope) return;
  viewed.add(scope.root);
  const variant = scope.variant ?? product.variants.nodes[0];
  const items = [itemFromVariant(product, variant)];
  const products = variant ? [productPayload(product, variant)] : [];
  send('view_item', { currency: variant?.price.currencyCode, value: totalValue(items), items }, 'product_viewed', {
    products,
  });
}

/** @param {ListReadyDetail} detail */
function onListReady({ products = [], collection }) {
  const items = products
    .slice(0, MAX_LIST_ITEMS)
    .map((product, index) => itemFromVariant(product, product.variants.nodes[0], 1, index));
  const list = { item_list_id: collection?.handle || 'products', item_list_name: collection?.title || 'Products' };
  if (!collection) {
    send('view_item_list', { ...list, items });
    return;
  }
  send('view_item_list', { ...list, items }, 'collection_viewed', {
    collection: { id: collection.id, handle: collection.handle },
  });
}

/**
 * @param {AnalyticsCart | null} cart
 * @param {Map<string, CartLine>} now
 * @param {Map<string, CartLine>} before
 */
function sendCartChanges(cart, now, before) {
  const currency = cart?.cost.totalAmount.currencyCode;
  now.forEach((line, variantId) => {
    const previous = before.get(variantId);
    const added = line.quantity - (previous?.quantity ?? 0);
    if (added <= 0) return;
    const items = [itemFromLine(line, added)];
    send('add_to_cart', { currency, value: totalValue(items), items }, 'product_added_to_cart', {
      cart,
      prevCart: lastCart,
      currentLine: linePayload(line),
      prevLine: previous ? linePayload(previous) : undefined,
    });
  });
  before.forEach((line, variantId) => {
    const removed = line.quantity - (now.get(variantId)?.quantity ?? 0);
    if (removed <= 0) return;
    const items = [itemFromLine(line, removed)];
    send('remove_from_cart', { currency, value: totalValue(items), items });
  });
}

/** @param {CartUpdatedDetail} detail */
function onCartUpdated({ cart, reason }) {
  const now = new Map((cart?.lines.nodes ?? []).map((line) => [line.merchandise.id, line]));
  // Loading the saved cart and showing a pending change aren't changes the visitor made.
  if (lastLines && reason !== 'load' && reason !== 'pending') sendCartChanges(cart, now, lastLines);
  lastLines = now;
  lastCart = cart;
}

function onCartOpened() {
  const items = Cart.lines.map((line) => itemFromLine(line));
  send('view_cart', { currency: Cart.state?.cost.totalAmount.currencyCode, value: totalValue(items), items });
}

/** @param {{ cart: AnalyticsCart }} detail */
function onCheckout({ cart }) {
  const items = cart.lines.nodes.map((line) => itemFromLine(line));
  const coupons = cart.discountCodes.filter((discount) => discount.applicable).map((discount) => discount.code);
  send('begin_checkout', {
    currency: cart.cost.totalAmount.currencyCode,
    value: totalValue(items),
    coupon: coupons.join(',') || undefined,
    items,
  });
}

/**
 * Turns one Tether event into analytics events. Only events Tether created count (`isOwnEvent`): their detail is the
 * one `emit` wrote for that name, the shape typed per event here. A look-alike event from another script, whatever
 * its detail, sends nothing.
 *
 * @param {Event} event `<prefix>:<name>`.
 */
function handle(event) {
  if (!isOwnEvent(event)) return;
  const name = event.type.slice(cfg.prefix.length + 1);
  /** @type {unknown} */
  const detail = Reflect.get(event, 'detail');
  switch (name) {
    case 'product-ready':
      onProductReady(/** @type {ProductReadyDetail} */ (detail));
      break;
    case 'list-ready':
      onListReady(/** @type {ListReadyDetail} */ (detail));
      break;
    case 'cart-updated':
      onCartUpdated(/** @type {CartUpdatedDetail} */ (detail));
      break;
    case 'cart-toggled':
      if (/** @type {{ open: boolean }} */ (detail).open) onCartOpened();
      break;
    case 'checkout':
      onCheckout(/** @type {{ cart: AnalyticsCart }} */ (detail));
      break;
    case 'search': {
      const { term } = /** @type {{ term: string }} */ (detail);
      if (term) send('search', { search_term: term }, 'search_viewed', { searchTerm: term });
      break;
    }
    case 'page':
      viewed = new WeakSet();
      bus?.publish('page_viewed', {});
      break;
    default:
      break;
  }
}

/**
 * Called by the core with the events it buffered while this part loaded; the queue then handles events as they come.
 *
 * @param {Event[]} queue
 */
export async function startAnalytics(queue) {
  if (cfg.analytics?.shopify) {
    bus = await startShopifyAnalytics(() => mainProduct() != null).catch((/** @type {unknown} */ error) => {
      reportError(error, 'shopify analytics');
      return null;
    });
  }
  bus?.publish('page_viewed', {});
  queue.splice(0).forEach(handle);
  queue.push = (...events) => {
    events.forEach(handle);
    return queue.length;
  };
}
