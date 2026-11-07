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
 * Shopify's analytics are set up in analytics-shopify.ts.
 */
import { cfg, reportError } from './config.ts';
import { ANALYTICS_EVENTS, isOwnEvent, sel } from './dom.ts';
import { Cart } from './cart.ts';
import { scopes } from './product.ts';
import { startShopifyAnalytics } from './analytics-shopify.ts';
import type { Money } from './shopify-values.ts';
import type { Product, ProductVariant } from './fragments.ts';
import type { AnalyticsBus, EventPayload } from './analytics-shopify.ts';
import type { ProductScope } from './product.ts';
import type { AnalyticsEventName, TetherEvents } from './markup.ts';

/** The fields of the cart's product (`fragment TetherCart`) this module reads. */
interface LineProduct {
  id: string;
  title: string;
  handle: string;
  vendor: string;
}

interface LineVariant {
  id: string;
  title: string;
  sku: string | null;
  price: Money;
  product: LineProduct;
}

interface CartLine {
  id: string;
  quantity: number;
  merchandise: LineVariant;
}

/** The fields of the cart (`fragment TetherCart`) this module reads. */
interface AnalyticsCart {
  lines: { nodes: CartLine[] };
  cost: { totalAmount: Money };
  discountCodes: { code: string; applicable: boolean }[];
}

/** What a GA4 item is built from: a product, or a cart line's product. */
interface ItemProduct {
  id: string;
  title: string;
  vendor?: string;
  productType?: string;
  priceRange?: { minVariantPrice: Money };
}

type ItemVariant = Pick<ProductVariant, 'id' | 'title' | 'sku' | 'price'>;

/** A GA4 ecommerce item. */
interface AnalyticsItem {
  item_id: string;
  item_name: string;
  item_variant: string | undefined;
  item_brand: string | undefined;
  item_category: string | undefined;
  price: number;
  quantity: number;
  index?: number;
}

/** Shopify's title for the one variant of a product without options. */
const DEFAULT_VARIANT_TITLE = 'Default Title';
const CENTS_PER_UNIT = 100;
/** GA4 drops an event with more items than this. */
const MAX_LIST_ITEMS = 200;

const amountOf = (money: Money | null | undefined): number => (money ? parseFloat(money.amount) : 0);

/** The numeric part of a gid. */
const numericId = (gid: string | null | undefined): string => (gid ?? '').split('/').pop() ?? '';

/** @param index The position in a list. */
function itemFromVariant(
  product: ItemProduct,
  variant: ItemVariant | null | undefined,
  quantity = 1,
  index?: number,
): AnalyticsItem {
  const item: AnalyticsItem = {
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

const itemFromLine = (line: CartLine, quantity = line.quantity) =>
  itemFromVariant(line.merchandise.product, line.merchandise, quantity);

/** The items' total, rounded to cents. */
function totalValue(items: AnalyticsItem[]): number {
  const total = items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);
  return Math.round(total * CENTS_PER_UNIT) / CENTS_PER_UNIT;
}

const productPayload = (product: Product, variant: ItemVariant, quantity = 1) => ({
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

const linePayload = (line: CartLine) => ({
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

/** The GA4 / GTM data layer, created when the page has none. */
function dataLayer(): unknown[] {
  const { dataLayer: option } = cfg.analytics ?? {};
  const name = typeof option === 'string' ? option : 'dataLayer';
  const existing: unknown = Reflect.get(window, name);
  if (Array.isArray(existing)) return existing;
  const created: unknown[] = [];
  Reflect.set(window, name, created);
  return created;
}

function pushToDataLayer(event: string, ecommerce: Record<string, unknown> | undefined): void {
  const layer = dataLayer();
  if (!ecommerce) {
    layer.push({ event });
    return;
  }
  // Google asks for the previous ecommerce object to be cleared first.
  layer.push({ ecommerce: null });
  layer.push({ event, ecommerce });
}

let bus: AnalyticsBus | null = null;
/** Variant id to line, to turn cart changes into add and remove events. */
let lastLines: Map<string, CartLine> | null = null;
let lastCart: AnalyticsCart | null = null;
/** Product roots whose view_item was sent on this page. */
let viewed = new WeakSet<Element>();
/** The body the last page_viewed was for: Astro's first `astro:page-load` comes after the landing page's. */
let viewedBody: HTMLElement | null = null;

/** @param name The GA4 event. */
function send(name: string, data: Record<string, unknown>, shopifyEvent?: string, shopifyPayload?: EventPayload): void {
  if (cfg.analytics?.dataLayer) pushToDataLayer(name, data);
  if (bus && shopifyEvent) bus.publish(shopifyEvent, shopifyPayload);
  try {
    cfg.analytics?.onEvent?.(name, data);
  } catch (error) {
    reportError(error, 'analytics onEvent');
  }
}

/** The scope of the page's own product: a product root outside every list. */
function mainProduct(): ProductScope | null {
  const el = document.querySelector(sel('product'));
  if (!el || el.closest(`${sel('collection')},${sel('products')},${sel('recommendations')}`)) return null;
  return scopes.get(el) ?? null;
}

function onProductReady({ product, scope }: TetherEvents['product-ready']): void {
  if (viewed.has(scope.root) || mainProduct() !== scope) return;
  viewed.add(scope.root);
  const variant = scope.variant ?? product.variants.nodes[0];
  const items = [itemFromVariant(product, variant)];
  const products = variant ? [productPayload(product, variant)] : [];
  send('view_item', { currency: variant?.price.currencyCode, value: totalValue(items), items }, 'product_viewed', {
    products,
  });
}

function onListReady({ products, collection }: TetherEvents['list-ready']): void {
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

function sendCartChanges(cart: AnalyticsCart | null, now: Map<string, CartLine>, before: Map<string, CartLine>): void {
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

function onCartUpdated({ cart, reason }: TetherEvents['cart-updated']): void {
  const now = new Map((cart?.lines.nodes ?? []).map((line) => [line.merchandise.id, line]));
  // Loading the saved cart and showing a pending change aren't changes the visitor made.
  if (lastLines && reason !== 'load' && reason !== 'pending') sendCartChanges(cart, now, lastLines);
  lastLines = now;
  lastCart = cart;
}

function onCartOpened(): void {
  const items = Cart.lines.map((line) => itemFromLine(line));
  send('view_cart', { currency: Cart.state?.cost.totalAmount.currencyCode, value: totalValue(items), items });
}

function onCheckout({ cart }: TetherEvents['checkout']): void {
  if (!cart) return;
  const items = cart.lines.nodes.map((line) => itemFromLine(line));
  const coupons = cart.discountCodes.filter((discount) => discount.applicable).map((discount) => discount.code);
  send('begin_checkout', {
    currency: cart.cost.totalAmount.currencyCode,
    value: totalValue(items),
    coupon: coupons.join(',') || undefined,
    items,
  });
}

/** What each event `ANALYTICS_EVENTS` names sends: one entry per name, so the list and this table can't diverge. */
const REPORTERS: { [Name in AnalyticsEventName]: (detail: TetherEvents[Name]) => void } = {
  'product-ready': onProductReady,
  'list-ready': onListReady,
  'cart-updated': onCartUpdated,
  'cart-toggled': ({ open }) => {
    if (open) onCartOpened();
  },
  checkout: onCheckout,
  search: ({ term }) => {
    if (term) send('search', { search_term: term }, 'search_viewed', { searchTerm: term });
  },
};

/** @param event The event Tether created as `name`. */
function report<Name extends AnalyticsEventName>(event: CustomEvent<TetherEvents[Name]>, name: Name): void {
  REPORTERS[name](event.detail);
}

function publishPageView(): void {
  viewedBody = document.body;
  bus?.publish('page_viewed', {});
}

/**
 * Turns one buffered event into analytics events: a Tether event from `ANALYTICS_EVENTS`, or Astro's `astro:page-load`
 * for a client-side navigation to a new body, which starts a new page view. Only events Tether created count
 * (`isOwnEvent`): a look-alike another script dispatches, whatever its detail, sends nothing.
 */
function handle(event: Event): void {
  if (event.type === 'astro:page-load') {
    if (viewedBody === document.body) return;
    viewed = new WeakSet();
    publishPageView();
    return;
  }
  ANALYTICS_EVENTS.forEach((name) => {
    if (isOwnEvent(event, name)) report(event, name);
  });
}

/**
 * Called by the core with the events it buffered while this part loaded; the queue then handles events as they come.
 */
export async function startAnalytics(queue: Event[]): Promise<void> {
  if (cfg.analytics?.shopify) {
    bus = await startShopifyAnalytics(() => mainProduct() != null).catch((error: unknown) => {
      reportError(error, 'shopify analytics');
      return null;
    });
  }
  publishPageView();
  queue.splice(0).forEach(handle);
  queue.push = (...events) => {
    events.forEach(handle);
    return queue.length;
  };
}
