/**
 * Tether's entry: `window.Tether`, `init()`, `mount()` and the start of the plain `<script>` setup.
 *
 *   <script>window.TETHER_CONFIG = { domain: 'x.myshopify.com', token: '...' }</script>
 *   <script src="tether.min.js" defer></script>
 *
 * With page transitions (Barba, Swup): set `autoMount: false`, call `Tether.init()` once and
 * `Tether.mount(container)` after every page enter.
 */
import { cfg, configure, isConfigured, log, warn, reportError, reportFailure } from './config.ts';
import { configView } from './config-view.ts';
import { query, TetherError, withContext } from './client.ts';
import { Cart } from './cart.ts';
import { scopes } from './product.ts';
import { listSelector, mountedList } from './collection.ts';
import { getProduct, clearProductCache, primeProduct, normalizeProductKey } from './loader.ts';
import * as plans from './selling-plans.ts';
import { resolveProductKey } from './status.ts';
import { sel, emit, isElement, isOwnEvent, formatMoney, imageUrl, pageGlobal } from './dom.ts';
import { loadPart, coreModules } from './lazy.ts';
import { PAGE_TRANSITION, queueAnalyticsEvents } from './analytics-queue.ts';
import { VERSION } from './version.ts';
import {
  mountedLists,
  liveLists,
  pruneLive,
  within,
  mountProduct,
  hydrateFromPage,
  settleMarket,
  trackMarket,
} from './mounting.ts';
import { applyStartMarket, setCountry } from './page-market.ts';
import { accountApi, mountAccountIfUsed } from './account-api.ts';
import { withPart } from './part-use.ts';
import { forgetBrowserModeTokens } from './account-marks.ts';
import { bindCartControls } from './controls/cart-controls.ts';
import { bindDiscountControls } from './controls/discount.ts';
import { addGroup, bindExtrasControls } from './controls/extras.ts';
import { bindNavigation, rememberDocumentMount } from './controls/navigation.ts';
import { field } from '../server/src/shared/json.ts';
import type { TetherConfig, TetherOptions, MarketsConfig } from './config.ts';
import type { ShopifyCart } from './cart/store.ts';
import type { ReadonlyProductScope } from './product.ts';
import type { DiagnoseOptions } from './diagnose.ts';
import type { TetherEvents } from './markup.ts';
import type { Parts, TetherInternals } from './lazy.ts';
import type { ProductQuery } from './loader.ts';

export { addGroup, setCountry, VERSION };

// The types a site uses by name, under the names the docs give them.
export type { TetherOptions as TetherConfig, TetherConfig as ResolvedTetherConfig } from './config.ts';
export type { MarketsConfig, CartWarning } from './config.ts';
export type { Money } from './shopify-values.ts';
export type {
  Image as ShopifyImage,
  Metafield as ShopifyMetafield,
  Product as ShopifyProduct,
  ProductVariant as ShopifyVariant,
  SellingPlan as ShopifySellingPlanNode,
  SellingPlanAdjustmentValue,
  SellingPlanAllocation as ShopifySellingPlanAllocation,
  SellingPlanGroup as ShopifySellingPlanGroup,
} from './fragments.ts';
export type {
  PlanInGroup as ShopifySellingPlan,
  PlanAdjustment,
  ProductWithPlans,
  VariantWithPlans,
} from './selling-plans.ts';
export type {
  CartStatus,
  CartUpdateReason,
  CartVariant as ShopifyCartVariant,
  ShopifyCart,
  ShopifyCartLine,
} from './cart/store.ts';
export type { Attributes, LineSpec as LineInput } from './cart/mutations.ts';
export type { TetherError, TetherErrorCode, GraphQLError, UserError } from './client.ts';
export type { ReadonlyProductScope as ProductScope } from './product.ts';
export type { Purchase } from './product-state.ts';
export type { ProductPage, ProductQuery } from './loader.ts';
export type { DetectedMarket, Localization, MarketSource } from './markets.ts';
export type { SetCountryOptions } from './page-market.ts';
export type { DiagnoseOptions, DiagnoseReport } from './diagnose.ts';
export type { TetherEvents } from './markup.ts';
export type { AccountCustomer } from './account/answers.ts';
export type { AccountImage as ImageRef, AccountOrder, AccountOrderLine } from '../server/src/shared/account-orders.ts';
export type { AddressFields as CustomerAddressInput } from './account/operations.ts';
export type {
  CustomerAddress,
  Fulfillment,
  MailingAddress,
  OrderDetail,
  OrderDetailLine,
  SubscriptionContract,
  SubscriptionLine,
} from './account/page-answers.ts';
/** The helpers for selling plans, `Tether.plans`. */
export type SellingPlanHelpers = typeof plans;

/** Milliseconds `observe` waits after the last added node, so a burst of additions mounts once. */
const OBSERVE_DEBOUNCE_MS = 50;

/** @returns The keys of `window.TETHER_CONFIG`, none when it is no object. */
function pageConfig(): Readonly<Record<string, unknown>> {
  const config = pageGlobal('TETHER_CONFIG');
  return typeof config === 'object' && config !== null ? Object.fromEntries(Object.entries(config)) : {};
}

let initPromise: Promise<Tether | null> | null = null;

let observer: MutationObserver | null = null;

/** The analytics part's queue, created once by the first `init()` with `analytics`. */
let analyticsQueue: Event[] | null = null;

/**
 * Set by `unmount()`: a page transition then mounts the next page's container, a new page in the same body. Astro's
 * navigation closes the cart without it, as its `astro:page-load` starts the page view.
 */
let pageLeft = false;

/** The document-wide listeners are bound once, by the first configured `init()`. */
let controlsBound = false;

/**
 * Mounts the lists of `root` and the product scopes in them as they render.
 *
 * @returns The lists mounted.
 */
function mountLists(root: ParentNode): number {
  let count = 0;
  within(root, listSelector()).forEach((el) => {
    if (mountedLists.has(el)) return;
    mountedLists.add(el);
    count++;
    const list = mountedList(el);
    liveLists.add(list);
    el.addEventListener(`${cfg.prefix}:list-rendered`, (event) => {
      // The list emits this once its products are in the page, with the element they are in.
      if (isOwnEvent(event, 'list-rendered')) mount(event.detail.container);
    });
    void trackMarket(list.load());
  });
  return count;
}

/**
 * Loads each optional part `root` uses: the country select, customer accounts and search as you type.
 */
function mountParts(root: ParentNode): void {
  if (within(root, `${sel('country-select')},${sel('country-bind')}`).length) {
    withPart('markets', (part) => part.renderCountrySelects(root));
  }
  mountAccountIfUsed(root);
  if (within(root, sel('search')).length) {
    withPart('search', (part) => {
      part.mountSearch(root);
    });
  }
}

/**
 * Mounts the lists, product scopes and parts inside `root`, after its hydrate tags were read (products the server
 * rendered into the page need no request), without the page-wide work that follows a mount.
 *
 * @returns The scopes and lists newly mounted.
 */
function mountWithin(root: Document | Element): number {
  let count = mountLists(root);
  within(root, sel('product')).forEach((el) => {
    if (mountProduct(el)) count++;
  });
  mountParts(root);
  return count;
}

/**
 * Mounts every product scope and product list inside `root`. Safe to call repeatedly. The first container mounted
 * after `unmount()` is a new page for analytics.
 *
 * @returns The scopes and lists newly mounted.
 */
export function mount(root: Document | Element = document): number {
  if (!isConfigured()) return 0;
  if (root === document) rememberDocumentMount();
  else if (pageLeft) analyticsQueue?.push(new Event(PAGE_TRANSITION));
  pageLeft = false;
  // Page transitions detach old roots: they aren't kept alive.
  pruneLive();
  hydrateFromPage(root.ownerDocument ?? document);
  const count = mountWithin(root);
  settleMarket();
  Cart.render();
  log(`mounted ${count} scope(s)`, root);
  return count;
}

/**
 * `observe`: mounts a burst of added elements at once. Each root is scanned on its own (an element inside another
 * added one is covered by it), and the page-wide work (market state, the cart's markup) runs once for the burst.
 */
function mountAdded(added: readonly Element[]): void {
  const roots = added.filter(
    (root) => root.isConnected && !added.some((other) => other !== root && other.contains(root)),
  );
  if (!roots.length || !isConfigured()) return;
  pruneLive();
  // Only the added elements are read for hydrate tags: the rest of the page was read when it was mounted. A load-more
  // fragment may bring its tag after the cards it is for, so every tag is read before any card mounts.
  roots.forEach((root) => {
    hydrateFromPage(root);
  });
  const count = roots.reduce((sum, root) => sum + mountWithin(root), 0);
  settleMarket();
  Cart.render();
  log(`mounted ${count} scope(s) in ${roots.length} added element(s)`);
}

/** Call before a page transition removes the page: closes the cart drawer; the next page's `mount()` is a new page. */
export function unmount(): void {
  pageLeft = true;
  Cart.close();
}

/** @returns The product scope `el` is in. */
export function getScope(el: Element | null | undefined): ReadonlyProductScope | null {
  const root = el?.closest(sel('product'));
  return root ? (scopes.get(root) ?? null) : null;
}

function bindControls() {
  if (controlsBound) return;
  controlsBound = true;
  bindCartControls();
  bindDiscountControls();
  bindExtrasControls();
  bindNavigation({ ready: () => initPromise ?? Promise.resolve(null), mount, unmount: Cart.close });
}

/**
 * A saved cart from another market moves to this one, so its prices match the page's.
 */
async function cartInPageMarket(cart: ShopifyCart | null): Promise<ShopifyCart | null> {
  const country = cfg.country;
  const cartCountry = cart?.buyerIdentity.countryCode;
  if (!country || !cartCountry || cartCountry === country) return cart;
  try {
    return await Cart.setBuyerIdentity({ countryCode: country }, { create: false });
  } catch (error) {
    reportError(error, 'cart country');
    return cart;
  }
}

/**
 * Configures Tether (`window.TETHER_CONFIG` with `overrides` over it), applies the visitor's market and loads the
 * cart. A second call without overrides returns the first one's promise.
 *
 * @returns `null` without a domain and token, when Tether stays idle.
 */
export function init(overrides: TetherOptions = {}): Promise<Tether | null> {
  if (initPromise && !Object.keys(overrides).length) return initPromise;
  configure({ ...pageConfig(), ...overrides });
  if (!isConfigured()) {
    warn('TETHER_CONFIG is missing domain or token. Tether is idle.');
    initPromise = Promise.resolve(null);
    return initPromise;
  }
  forgetBrowserModeTokens();
  bindControls();
  if (cfg.observe) startObserver();
  if (cfg.analytics) analyticsQueue ??= queueAnalyticsEvents(() => loadPart('analytics'));
  initPromise = applyStartMarket(overrides)
    .then(() => Cart.init())
    .then(cartInPageMarket)
    .then((cart) => {
      emit('ready', { cart });
      return api;
    });
  return initPromise;
}

/** `observe`: mounts the elements added to the page later. */
function startObserver() {
  if (observer || typeof MutationObserver === 'undefined') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queued = new Set<Element>();
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (isElement(node)) queued.add(node);
      });
    });
    clearTimeout(timer);
    timer = setTimeout(() => {
      const added = [...queued];
      queued.clear();
      mountAdded(added);
    }, OBSERVE_DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** @param markets Default `markets` of the config. */
const detectMarket = (markets?: MarketsConfig | null) =>
  loadPart('markets').then((part) => part.detectMarket(markets ?? cfg.markets));

/** `Tether.getProducts()`: a page of a collection or a search, from the lists part. */
const getProducts = (query?: ProductQuery) => loadPart('lists').then((part) => part.getProducts(query));

/** `Tether.getRecommendations()`: Shopify's recommendations for a product, from the lists part. */
const getRecommendations: Parts['lists']['getRecommendations'] = (product, intent) =>
  loadPart('lists').then((part) => part.getRecommendations(product, intent));

const getLocalization = () => loadPart('markets').then((part) => part.getLocalization());

const diagnose = (options?: Omit<DiagnoseOptions, 'version'>) =>
  loadPart('diagnose').then((part) => part.diagnose({ ...options, version: VERSION }));

/**
 * Listens to the Tether event `<prefix>:<name>`. Only the events Tether dispatched reach the listener: one another
 * script dispatches under the same name is ignored, so the detail is always the one `TetherEvents` gives.
 *
 * @returns Stops listening.
 */
function on<Name extends keyof TetherEvents>(
  name: Name,
  listener: (detail: TetherEvents[Name], event: CustomEvent<TetherEvents[Name]>) => void,
): () => void {
  const type = `${cfg.prefix}:${name}`;
  const handler = (event: Event) => {
    if (isOwnEvent(event, name)) listener(event.detail, event);
  };
  document.addEventListener(type, handler);
  return () => {
    document.removeEventListener(type, handler);
  };
}

const publicApi = {
  VERSION,
  init,
  mount,
  unmount,
  /** The live config, read-only. */
  get config(): Readonly<TetherConfig> {
    return configView;
  },
  get ready(): Promise<Tether | null> {
    return initPromise ?? Promise.resolve(null);
  },
  query,
  withContext,
  cart: Cart,
  getProduct,
  getProducts,
  getRecommendations,
  getScope,
  addGroup,
  account: accountApi,
  primeProduct,
  normalizeProductKey,
  clearProductCache,
  formatMoney,
  imageUrl,
  plans,
  TetherError,
  resolveProductKey,
  setCountry,
  detectMarket,
  getLocalization,
  diagnose,
  on,
};

/** `window.Tether`, and what `import Tether from '@occluze/tether'` gives. */
export type Tether = typeof publicApi;

const internals: TetherInternals = { __core: coreModules, __parts: {} };

/** `Tether`, also carrying `TetherInternals`, which the published type leaves out. */
export const api: Tether = Object.assign(publicApi, internals);

/** @alias `api`, for `import Tether from '@occluze/tether'`. */
export default api;

/**
 * The plain `<script>` setup starts by itself, unless `autoMount: false` or a framework integration (Astro), which
 * starts Tether itself.
 */
function autoStart() {
  // `window.Tether` is declared by the published types, which describe this object to sites; the source doesn't
  // depend on them.
  Reflect.set(window, 'Tether', api);
  const config = pageGlobal('TETHER_CONFIG');
  if (!config || field(config, 'autoMount') === false || pageGlobal('TETHER_INTEGRATION')) return;
  const start = () => {
    reportFailure(
      init().then(() => mount(document)),
      'init',
    );
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') autoStart();
