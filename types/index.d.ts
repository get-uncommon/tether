// Type definitions for @occluze/tether
// The Shopify Storefront API objects are the fields Tether's own queries select, as Shopify sends them.
// See https://shopify.dev/docs/api/storefront for each field.

export interface Money {
  amount: string;
  currencyCode: string;
}
export interface ShopifyImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export type SellingPlanAdjustmentValue =
  | { __typename: 'SellingPlanPercentagePriceAdjustment'; adjustmentPercentage: number }
  | { __typename: 'SellingPlanFixedAmountPriceAdjustment'; adjustmentAmount: Money }
  | { __typename: 'SellingPlanFixedPriceAdjustment'; price: Money };

/** A selling plan as its group lists it. */
export interface ShopifySellingPlanNode {
  id: string;
  name: string;
  description: string | null;
  recurringDeliveries: boolean;
  options: { name: string; value: string }[];
  priceAdjustments: { orderCount: number | null; adjustmentValue: SellingPlanAdjustmentValue }[];
}

export interface ShopifySellingPlanGroup {
  name: string;
  appName: string | null;
  options: { name: string; values: string[] }[];
  sellingPlans: { nodes: ShopifySellingPlanNode[] };
}

/** A plan with the group it belongs to: what the plan helpers and a product scope hand out. */
export interface ShopifySellingPlan extends ShopifySellingPlanNode {
  group: ShopifySellingPlanGroup;
}

/** A variant's price on one plan. */
export interface ShopifySellingPlanAllocation {
  sellingPlan: { id: string };
  /** What the customer pays at checkout (more for a prepaid plan). */
  checkoutChargeAmount: Money;
  remainingBalanceChargeAmount: Money;
  priceAdjustments: { price: Money; compareAtPrice: Money; perDeliveryPrice: Money; unitPrice: Money | null }[];
}

export interface ShopifyVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  currentlyNotInStock: boolean;
  /** Absent when the store's token can't read inventory. */
  quantityAvailable?: number | null;
  sku: string | null;
  barcode: string | null;
  selectedOptions: { name: string; value: string }[];
  image: ShopifyImage | null;
  price: Money;
  compareAtPrice: Money | null;
  unitPrice: Money | null;
  sellingPlanAllocations: { nodes: ShopifySellingPlanAllocation[] };
}

export interface ShopifyMetafield {
  namespace: string;
  key: string;
  type: string;
  value: string;
  /** A file reference's image. */
  reference: { image?: ShopifyImage } | null;
}

export interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  availableForSale: boolean;
  publishedAt: string | null;
  onlineStoreUrl: string | null;
  requiresSellingPlan: boolean;
  seo: { title: string | null; description: string | null };
  featuredImage: ShopifyImage | null;
  images: { nodes: ShopifyImage[] };
  options: { name: string; optionValues: { name: string; swatch: unknown }[] }[];
  priceRange: { minVariantPrice: Money; maxVariantPrice: Money };
  compareAtPriceRange: { minVariantPrice: Money; maxVariantPrice: Money };
  /** Present when `metafields` are configured; null for one that isn't set. */
  metafields?: (ShopifyMetafield | null)[];
  sellingPlanGroups: { nodes: ShopifySellingPlanGroup[] };
  variants: { nodes: ShopifyVariant[] };
}

/** A cart line's `merchandise`. */
export interface ShopifyCartVariant {
  id: string;
  title: string;
  sku: string | null;
  availableForSale: boolean;
  requiresShipping: boolean;
  /** Absent when the store's token can't read inventory. */
  quantityAvailable?: number | null;
  image: ShopifyImage | null;
  price: Money;
  compareAtPrice: Money | null;
  selectedOptions: { name: string; value: string }[];
  product: { id: string; title: string; handle: string; vendor: string; featuredImage: ShopifyImage | null };
}

export interface ShopifyCartLine {
  id: string;
  quantity: number;
  attributes: { key: string; value: string }[];
  cost: {
    totalAmount: Money;
    subtotalAmount: Money;
    amountPerQuantity: Money;
    compareAtAmountPerQuantity: Money | null;
  };
  discountAllocations: { discountedAmount: Money }[];
  sellingPlanAllocation: {
    sellingPlan: Omit<ShopifySellingPlanNode, 'priceAdjustments'>;
    checkoutChargeAmount: Money;
    priceAdjustments: { price: Money; compareAtPrice: Money; perDeliveryPrice: Money }[];
  } | null;
  merchandise: ShopifyCartVariant;
  /** Only on a bundle. */
  lineComponents?: {
    id: string;
    quantity: number;
    merchandise: { id: string; title: string; product: { title: string; handle: string } };
  }[];
}

export interface ShopifyCart {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  attributes: { key: string; value: string }[];
  buyerIdentity: { countryCode: string | null; email: string | null };
  discountCodes: { code: string; applicable: boolean }[];
  cost: { subtotalAmount: Money; totalAmount: Money; checkoutChargeAmount: Money };
  lines: { nodes: ShopifyCartLine[] };
}

export interface MarketsConfig {
  /** true: saved choice, server hints, Webflow Localization. Or a list of those sources. false: off. */
  detect?: boolean | ('saved' | 'server' | 'webflow')[];
  /** Webflow locale (subdirectory or html lang) -> market. */
  locales?: Record<string, { country?: string; language?: string; locale?: string }>;
  /** Cookie with the visitor's country, set by your server (default "tether_country"). */
  cookie?: string;
  /** Remember the visitor's country choice (default true). */
  remember?: boolean;
  /** With locales: ignore an html lang that isn't in the map. */
  strict?: boolean;
}

export interface TetherConfig {
  /** your-store.myshopify.com */
  domain: string;
  /** Public Storefront API access token (never an Admin token). */
  token: string;
  /** Pinned Shopify API version, e.g. "2026-07". Never "unstable". */
  apiVersion?: string;
  /** ISO country code for prices and currency, e.g. "NL". */
  country?: string;
  /** Language for translated content, e.g. "NL". */
  language?: string;
  /** Intl locale for money and dates, e.g. "nl-NL". */
  locale?: string;
  markets?: MarketsConfig | null;
  /** Attribute prefix (default "tether"). */
  prefix?: string;
  /** Product URL template: "/product" or "/product?handle={handle}" ({handle}, {id}). */
  productPath?: string;
  collectionPath?: string;
  /** Metafields to fetch: "namespace.key" or { namespace, key }. */
  metafields?: (string | { namespace: string; key: string })[];
  imagesFirst?: number;
  variantsFirst?: number;
  sellingPlanGroupsFirst?: number;
  sellingPlansFirst?: number;
  collectionFirst?: number;
  retries?: number;
  /** Products handed over by the server (tether/server hydrate()): refresh once in the background (default true). */
  revalidate?: boolean;
  /** Seconds a Shopify answer may be cached (default 60). Shopify caches identical queries, prices included, for hours otherwise; 0 = Shopify's caching. */
  maxAge?: number;
  /** Analytics (optional part): GA4/GTM dataLayer events, Shopify's analytics (experimental), or your own handler. */
  analytics?: {
    dataLayer?: boolean | string;
    /** proxy: true when the site serves the Storefront API on its own domain. */
    shopify?: boolean | { consent?: 'no-banner' | 'default-banner' | 'custom-banner'; proxy?: boolean };
    onEvent?: (name: string, data: Record<string, unknown>) => void;
  } | null;
  /** Customer accounts (optional part), through your Worker: without `server` they are off. */
  account?: {
    /** The Worker's account routes, a URL or a path on this site ('/_tether/account'). */
    server: string;
    /** Your own order page: tether-order-bind="url" links there, e.g. '/account/order?id={id}' (else Shopify's status page). */
    orderUrl?: string;
    /** Shopify's subscription management page (tether-account-link="subscriptions"); payment methods are changed there too. */
    subscriptionsUrl?: string;
    /** A separate page for payment methods (tether-account-link="payment"); default subscriptionsUrl. */
    paymentUrl?: string;
    /** Where Shopify sends the visitor after logout (registered as logout URI). Default: the home page. */
    logoutUrl?: string;
    locale?: string;
    /** Replaces location.assign for the login redirect (popups, tests). */
    navigate?: (url: string) => void;
  } | null;
  /** tether-show="low-stock" at this many or fewer (default 5). */
  lowStock?: number;
  /** Milliseconds the search part waits after the last keystroke (default 150). */
  searchDelay?: number;
  /** true: ?variant= (and selling_plan=) follow the visitor's choice on the page's main product. */
  variantUrl?: boolean;
  /** Your text for Shopify's cart warnings (stock, codes), e.g. translated by code. Return nothing to keep Shopify's. */
  warningText?: ((warning: CartWarning) => string | null | undefined) | null;
  /** Mount on Astro View Transitions (astro:page-load) and close the cart on navigation (default true). */
  astro?: boolean;
  storageKey?: string | null;
  cartDrawerOpenClass?: string;
  openCartOnAdd?: boolean;
  /** Move focus into the open cart, keep Tab inside it, restore it on close (default true). */
  cartFocus?: boolean;
  checkoutTarget?: '_self' | '_blank';
  defaultPurchase?: 'one-time' | 'subscription';
  /** Mount the document on DOMContentLoaded (default true). False with page transitions. */
  autoMount?: boolean;
  /** Mount elements added later (CMS load more, filters). */
  observe?: boolean;
  /** Folder of the optional parts (tether.markets.min.js, tether.diagnose.min.js) for the <script> build. */
  partsUrl?: string | null;
  formatMoney?: ((money: Money, locale?: string) => string) | null;
  onLayoutChange?: ((reason: string) => void) | null;
  onCartOpen?: ((drawers: HTMLElement[]) => void) | null;
  onCartClose?: ((drawers: HTMLElement[]) => void) | null;
  onLineEnter?: ((node: HTMLElement) => void) | null;
  onLineLeave?: ((node: HTMLElement, done: () => void) => void) | null;
  onValueChange?: ((el: HTMLElement, previousText: string) => void) | null;
  /**
   * Every failure that reaches the visitor. Send it to Sentry or similar. `error` is usually a TetherError, but a
   * throwing hook or a browser API can make it anything, so a handler may narrow it.
   */
  onError?: Handler<[error: unknown, context: string]> | null;
  debug?: boolean;
}

/**
 * A hook Tether calls with `Args`. Declared as a method so a site's handler may type its parameters narrower than
 * Tether's (`(error: Error) => …`).
 */
export type Handler<Args extends unknown[]> = { bivarianceHack(...args: Args): void }['bivarianceHack'];

/** `Tether.config`: every option with its default filled in, read-only (pass options to `init()` to change them). */
export type ResolvedTetherConfig = {
  readonly [Key in Exclude<keyof TetherConfig, MarketOption>]-?: Exclude<TetherConfig[Key], undefined>;
} & { readonly [Key in MarketOption]?: TetherConfig[Key] };
/** The market options, unset until a market is configured or detected. */
type MarketOption = 'country' | 'language' | 'locale';

export type TetherErrorCode =
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'NOT_CONFIGURED'
  | 'NOT_LOGGED_IN'
  | 'INVALID'
  | 'INVALID_COUNTRY'
  | 'INVALID_DISCOUNT'
  | 'ERROR'
  | `HTTP_${number}`;

export declare class TetherError extends Error {
  name: 'TetherError';
  /** Shopify's own codes for refused input are on `userErrors`. */
  code: TetherErrorCode;
  status?: number;
  errors?: GraphQLError[];
  /** A mutation's user errors (code INVALID for refused account input). */
  userErrors?: readonly UserError[];
  constructor(
    message: string,
    opts?: { status?: number; errors?: GraphQLError[]; userErrors?: readonly UserError[]; code?: TetherErrorCode },
  );
}

/** An error in a GraphQL response, as the GraphQL spec sets it. */
export interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}

/** A mutation's note on input it refused. */
export interface UserError {
  message: string;
  field?: string[] | null;
  code?: string | null;
}

export type Attributes = Record<string, string | number | boolean> | { key: string; value: string }[];

export interface LineInput {
  variantId?: string;
  merchandiseId?: string;
  quantity?: number;
  sellingPlanId?: string | null;
  attributes?: Attributes;
}

/** Shopify's note on the last cart change; target is the cart line id it's about. */
export interface CartWarning {
  code: string;
  message: string;
  target?: string;
}

/**
 * What the cart is known to be: `unknown` until the saved cart has loaded, `empty` without a cart, `error` after a
 * failed load or change (with the cart as Shopify last sent it).
 */
export type CartStatus =
  | { kind: 'unknown' }
  | { kind: 'empty' }
  | { kind: 'ready'; cart: ShopifyCart }
  | { kind: 'error'; error: unknown; cart: ShopifyCart | null };

export interface Cart {
  readonly status: CartStatus;
  readonly state: ShopifyCart | null;
  /** A copy of the lines: changing it changes nothing in the cart. */
  readonly lines: ShopifyCartLine[];
  readonly count: number;
  /** The failure of the last load or change, until a change succeeds. */
  readonly lastError: Error | null;
  /** Shopify's notes on the last change, e.g. less stock than asked (code MERCHANDISE_NOT_ENOUGH_STOCK). */
  readonly warnings: CartWarning[];
  /** true once the saved cart (or the absence of one) is known. */
  readonly loaded: boolean;
  /**
   * Where a logged-in customer checks out (set by the account part), or null to clear it: the resolver answers the
   * customer's checkout URL for the cart, which opens with `logged_in=true`; null from it uses the cart's own URL.
   */
  setCheckoutResolver(resolver: (() => Promise<string | null>) | null): void;
  id(): string | null;
  init(): Promise<ShopifyCart | null>;
  /** Forgets the saved cart on this device: the page shows an empty cart (`tether:cart-updated`, reason `load`). */
  forgetSaved(): void;
  /** add(variantId, qty) · add({ variantId, quantity, sellingPlanId, attributes }) · add([line, line]) */
  add(
    input: string | LineInput | LineInput[],
    quantity?: number,
    opts?: Omit<LineInput, 'variantId' | 'quantity'>,
  ): Promise<ShopifyCart>;
  /** updateLine(id, 3) · updateLine(id, { sellingPlanId: null }) switches to one-time. null without a cart. */
  updateLine(lineId: string, patch: number | (LineInput & { quantity?: number })): Promise<ShopifyCart | null>;
  /** null without a cart. */
  removeLine(lineIds: string | string[]): Promise<ShopifyCart | null>;
  /** +1 / -1 for a line; quick clicks add up and show at once (use it for your own +/- buttons). */
  changeQuantity(lineId: string, delta: number): Promise<ShopifyCart | null>;
  /** The quantity to show for a line: what the visitor asked for while an update is on its way. */
  quantityOf(line: ShopifyCartLine): number;
  clear(): Promise<ShopifyCart | null>;
  /** The changed cart; null without a cart (these never create one). */
  setNote(note: string): Promise<ShopifyCart | null>;
  setAttributes(attributes: Attributes): Promise<ShopifyCart | null>;
  setDiscountCodes(codes: string[]): Promise<ShopifyCart | null>;
  /** Rejects with code INVALID_DISCOUNT (and doesn't keep the code) when Shopify doesn't accept it. */
  applyDiscount(code: string): Promise<ShopifyCart | null>;
  removeDiscount(code: string): Promise<ShopifyCart | null>;
  setBuyerIdentity(
    identity: { countryCode?: string; email?: string; phone?: string },
    opts?: { create?: boolean },
  ): Promise<ShopifyCart | null>;
  /** Goes to Shopify's checkout: the checkout URL, null with nothing to check out or after a reported failure. */
  checkout(target?: '_self' | '_blank'): Promise<string | null>;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  drawers(): HTMLElement[];
  render(): void;
  /** For framework islands: fn(cart, meta) now, when the saved cart has loaded and after every change. Returns unsubscribe. */
  subscribe(
    fn: (
      cart: ShopifyCart | null,
      meta: { open: boolean; count: number; loaded: boolean; warnings: CartWarning[] },
    ) => void,
  ): () => void;
}

/**
 * How a product scope's visitor wants to buy. Buying once keeps the plan offered next to the one-time price
 * (`null` for a product without plans); subscribing names the plan.
 */
export type Purchase = { kind: 'one-time'; offeredPlanId: string | null } | { kind: 'subscription'; planId: string };

export interface ProductScope {
  readonly root: HTMLElement;
  product: ShopifyProduct;
  variant: ShopifyVariant | null;
  selected: Record<string, string>;
  quantity: number;
  plans: ShopifySellingPlan[];
  /** How the visitor buys; change it with setPurchase() and selectPlan(). */
  readonly purchase: Purchase;
  readonly plan: ShopifySellingPlan | null;
  readonly isSubscription: boolean;
  readonly subscriptionAvailable: boolean;
  select(option: string, value: string): void;
  selectVariant(id: string): void;
  setPurchase(mode: 'one-time' | 'subscription'): void;
  selectPlan(ref: string): void;
  setQuantity(n: number | string): void;
  getLine(): LineInput | null;
  addToCart(): Promise<ShopifyCart | null>;
  update(product: ShopifyProduct): void;
}

/** What the plan helpers read of a product. */
export interface ProductWithPlans {
  sellingPlanGroups?: { nodes: ShopifySellingPlanGroup[] } | null;
}
/** What the plan helpers read of a variant. */
export interface VariantWithPlans {
  price: Money;
  sellingPlanAllocations?: { nodes: ShopifySellingPlanAllocation[] } | null;
}
export type PlanAdjustment =
  { type: 'percentage'; value: number } | { type: 'amount'; value: Money } | { type: 'price'; value: Money };

export interface SellingPlanHelpers {
  allPlans(product: ProductWithPlans | null | undefined): ShopifySellingPlan[];
  hasPlans(product: ProductWithPlans | null | undefined): boolean;
  /** null when the variant isn't on the plan. */
  allocationFor(
    variant: VariantWithPlans | null | undefined,
    planId: string | null | undefined,
  ): ShopifySellingPlanAllocation | null;
  plansForVariant(
    product: ProductWithPlans | null | undefined,
    variant: VariantWithPlans | null | undefined,
  ): ShopifySellingPlan[];
  /** The price per delivery on the plan; the one-time price when the variant isn't on it. */
  planPrice(variant: VariantWithPlans | null | undefined, planId: string | null | undefined): Money | null;
  planCheckoutCharge(variant: VariantWithPlans | null | undefined, planId: string | null | undefined): Money | null;
  planSavings(
    variant: VariantWithPlans | null | undefined,
    planId: string | null | undefined,
  ): { amount: Money | null; percentage: number };
  planAdjustment(plan: Pick<ShopifySellingPlanNode, 'priceAdjustments'> | null | undefined): PlanAdjustment | null;
  /** By id, numeric id, name or option value (case-insensitive). */
  findPlan(product: ProductWithPlans | null | undefined, ref: string | null | undefined): ShopifySellingPlan | null;
  /** The gid of a numeric id; a gid or other value as written; null when empty. */
  toGid(value: unknown, type: string): string | null;
  GID: {
    product(value: unknown): string | null;
    variant(value: unknown): string | null;
    sellingPlan(value: unknown): string | null;
  };
}

export interface ProductPage {
  collection: Record<string, unknown> | null;
  products: ShopifyProduct[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface Localization {
  country?: { isoCode: string; name: string; currency?: { isoCode: string; symbol: string } };
  language?: { isoCode: string; name: string };
  availableCountries: {
    isoCode: string;
    name: string;
    currency?: { isoCode: string; symbol: string };
    availableLanguages?: { isoCode: string; name: string }[];
  }[];
}

export type MarketSource = 'saved' | 'server' | 'webflow';

/** The market fields detection found, and the source each came from (no sources with detect: false). */
export interface DetectedMarket {
  country?: string;
  language?: string;
  locale?: string;
  sources?: Partial<Record<'country' | 'language' | 'locale', MarketSource>>;
}

export interface DiagnoseReport {
  version: string;
  config: Record<string, unknown>;
  apiVersion: { version: string; ok: boolean; monthsLeft?: number; next?: string; note: string };
  /** The market in use (a visitor's choice included), and what detection would pick (null without markets.detect). */
  market: { country: string | null; language: string | null; locale: string | null; detected: DetectedMarket | null };
  reachable: boolean;
  shop: { name?: string; url?: string; currency?: string } | null;
  latencyMs: number | null;
  products: {
    key: string;
    handle?: string;
    title?: string;
    plans?: number;
    requiresSellingPlan?: boolean;
    error?: string;
  }[];
  sellingPlans: { product: string; group?: string; plan: string; id: string }[];
  problems: { level: 'error' | 'warn'; message: string; element?: string }[];
}

/** Events on document, as `tether:<name>` (or your prefix). Detail types for Tether.on(). */
export interface TetherEvents {
  ready: { cart: ShopifyCart | null };
  'product-ready': { product: ShopifyProduct; scope: ProductScope };
  'product-updated': { product: ShopifyProduct; scope: ProductScope };
  'product-not-found': { key: string | null; source: string };
  'variant-changed': {
    product: ShopifyProduct;
    variant: ShopifyVariant;
    selected: Record<string, string>;
    purchase: 'one-time' | 'subscription';
    sellingPlanId: string | null;
  };
  'product-added': { product: ShopifyProduct; variant: ShopifyVariant; line: LineInput };
  added: { cart: ShopifyCart; lines: LineInput[] };
  'group-added': { group: string | null; lines: LineInput[] };
  'cart-warning': { warnings: CartWarning[] };
  'cart-updated': { cart: ShopifyCart | null; reason: string };
  'cart-toggled': { open: boolean };
  'cart-error': { error: Error };
  checkout: { url: string; cart: ShopifyCart };
  'list-ready': { products: ShopifyProduct[]; collection: Record<string, unknown> | null };
  /** A list's cards were drawn (again): container holds them. */
  'list-rendered': { container: HTMLElement };
  /** The search part's suggestions for term. */
  search: {
    term: string;
    products: {
      id: string;
      handle: string;
      title: string;
      availableForSale: boolean;
      featuredImage: ImageRef | null;
      priceRange: { minVariantPrice: Money };
    }[];
    collections: { handle: string; title: string; image: ImageRef | null }[];
    queries: { text: string }[];
  };
  'country-changed': { country: string; language?: string };
  'discount-applied': { code: string };
  'discount-invalid': { code: string };
  'layout-changed': { reason: string };
  error: { error: Error; context: string; key?: string };
  'account-login': Record<string, never>;
  'account-logout': Record<string, never>;
  /** A login that failed: 'expired' (it took too long, or came back to another browser) or 'error'. */
  'account-error': { error: string };
  'account-updated': { what: 'profile' | 'addresses' | 'subscriptions' | 'orders' };
}

export interface Tether {
  readonly VERSION: string;
  /** Configure (window.TETHER_CONFIG + overrides) and load the cart. */
  init(overrides?: Partial<TetherConfig>): Promise<Tether | null>;
  /** Mount product scopes and lists inside root (call per page container with Barba/Swup). */
  mount(root?: ParentNode): number;
  /** Call before a page transition removes the page (closes the cart drawer). */
  unmount(): void;
  /** The live config, read-only: a write throws in strict-mode code. Change it with init(options). */
  readonly config: ResolvedTetherConfig;
  readonly ready: Promise<Tether | null>;
  /** Any Storefront API query, with @inContext added for the current market. */
  query<T = unknown>(query: string, variables?: Record<string, unknown>, opts?: { context?: boolean }): Promise<T>;
  withContext(query: string, ctx?: { country?: string; language?: string }): string;
  cart: Cart;
  /** By handle, numeric id, gid or product URL; rejects with NOT_FOUND when the store has no such product. */
  getProduct(handleOrId: string | number | null | undefined): Promise<ShopifyProduct>;
  getProducts(opts?: {
    collection?: string;
    query?: string;
    first?: number;
    after?: string | null;
    sortKey?: string;
    reverse?: boolean;
    filters?: unknown[];
  }): Promise<ProductPage>;
  getRecommendations(
    product: string | number | Pick<ShopifyProduct, 'id'> | null | undefined,
    intent?: 'RELATED' | 'COMPLEMENTARY',
  ): Promise<ShopifyProduct[]>;
  getScope(el: Element | null | undefined): ProductScope | null;
  addGroup(button: Element): Promise<ShopifyCart | null>;
  /** Customer accounts through your Worker (loads the account part). */
  account: {
    login(opts?: { returnTo?: string; locale?: string }): Promise<void>;
    logout(opts?: { returnTo?: string }): Promise<void>;
    /** The logged-in customer; null when nobody is. */
    customer(): Promise<AccountCustomer | null>;
    /** The customer's most recent orders, newest first; [] when nobody is logged in. */
    orders(opts?: { first?: number }): Promise<AccountOrder[]>;
    /** True when the Worker last said a customer is logged in; false before the page has asked it. */
    isLoggedIn(): Promise<boolean>;
    /** Fills the account markup in root: logged-in/out content, the customer, orders and the account pages. */
    render(root?: ParentNode): Promise<void>;
    /** What mount() runs: finishes a login coming back on the first call, then renders root. */
    mountAccount(root?: ParentNode): Promise<void>;
    /** One order in full (lines, totals, addresses, fulfillments with tracking, returnable lines); null if not the customer's. */
    order(id: string | number): Promise<OrderDetail | null>;
    updateProfile(fields?: {
      firstName?: string;
      lastName?: string;
    }): Promise<{ firstName: string | null; lastName: string | null }>;
    addresses(): Promise<Array<CustomerAddress & { isDefault: boolean }>>;
    saveAddress(
      address: Partial<CustomerAddressInput> | null,
      opts?: { id?: string; isDefault?: boolean },
    ): Promise<CustomerAddress>;
    deleteAddress(id: string): Promise<string>;
    subscriptions(): Promise<SubscriptionContract[]>;
    /** The changed contract (pause, resume, cancel) or next billing cycle (skip, unskip). */
    subscriptionAction(
      id: string | number,
      action: 'pause' | 'resume' | 'skip' | 'unskip' | 'cancel',
    ): Promise<
      | { contract: { id: string | null; status: string | null } }
      | { billingCycle: { cycleIndex: number | null; skipped: boolean } }
    >;
    requestReturn(
      orderId: string | number,
      lines: Array<{ lineItemId: string; quantity: number; reasonId?: string; note?: string }>,
    ): Promise<{ id: string; status: string | null }>;
  };
  primeProduct(product: ShopifyProduct | null | undefined): void;
  normalizeProductKey(raw: string | number | null | undefined): string | null;
  clearProductCache(): void;
  formatMoney(money: Money | null | undefined): string;
  /** Shopify CDN image at a size: imageUrl(line.merchandise.image?.url, { width: 160 }); `url` itself when empty. */
  imageUrl<Url extends string | null | undefined>(
    url: Url,
    size?: { width?: number | string | null; height?: number | string | null; crop?: string | null },
  ): Url;
  plans: SellingPlanHelpers;
  TetherError: typeof TetherError;
  resolveProductKey(
    el: Element,
    location?: Pick<Location, 'pathname' | 'search'>,
    name?: string,
  ): { key: string | null; fromUrl: boolean; raw: string };
  /** Switch market: prices, currency, cart and every product on the page follow. */
  setCountry(code: string, opts?: SetCountryOptions): Promise<ShopifyCart | null>;
  detectMarket(markets?: MarketsConfig | null): Promise<DetectedMarket>;
  getLocalization(): Promise<Localization>;
  /** Logs and returns what's wrong on this page (config, token, API version, plans, markup). */
  diagnose(opts?: { root?: ParentNode; silent?: boolean; now?: Date }): Promise<DiagnoseReport>;
  /** Listen to a Tether event; returns a function that stops listening. */
  on<K extends keyof TetherEvents>(
    name: K,
    fn: (detail: TetherEvents[K], event: CustomEvent<TetherEvents[K]>) => void,
  ): () => void;
  on(name: string, fn: (detail: unknown, event: CustomEvent) => void): () => void;
  /** Internal: the core modules the `<script>` build's optional parts share. Not an API. */
  readonly __core: unknown;
  /** Internal: where the `<script>` build's optional parts register. Not an API. */
  readonly __parts: Record<string, unknown>;
}

export declare const VERSION: string;
export declare function init(overrides?: Partial<TetherConfig>): Promise<Tether | null>;
export declare function mount(root?: ParentNode): number;
export declare function unmount(): void;
export declare function getScope(el: Element | null | undefined): ProductScope | null;
export declare function addGroup(button: Element): Promise<ShopifyCart | null>;
export interface SetCountryOptions {
  /** Shopify language (translations); null clears it. Default: the markets.locales entry for that country, else unchanged. */
  language?: string | null;
  /** Money format, e.g. 'de-DE'. Default: the markets.locales entry for that country, else unchanged. */
  locale?: string;
  remember?: boolean;
}
export declare function setCountry(code: string, opts?: SetCountryOptions): Promise<ShopifyCart | null>;
export declare const api: Tether;
declare const tether: Tether;
export default tether;

declare global {
  interface Window {
    Tether: Tether;
    TETHER_CONFIG?: Partial<TetherConfig>;
    TETHER_COUNTRY?: string;
    TETHER_LANGUAGE?: string;
  }
}

export interface CustomerAddressInput {
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  zip: string;
  zoneCode: string;
  countryCode: string;
  phoneNumber: string;
}
/** An address as Shopify sends it: fields it leaves out are null. */
export interface MailingAddress {
  id: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zoneCode: string | null;
  zip: string | null;
  country: string | null;
  countryCode: string | null;
  phoneNumber: string | null;
  /** One line per entry. */
  formatted: string[];
}
/** One of the customer's saved addresses. */
export interface CustomerAddress extends MailingAddress {
  id: string;
}

/** An image as the account and search answers carry it. */
export interface ImageRef {
  url: string;
  altText: string | null;
}
/** The logged-in customer. */
export interface AccountCustomer {
  id?: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  emailAddress: { emailAddress: string } | null;
  defaultAddress: { formatted: string[] } | null;
}
export interface AccountOrderLine {
  title: string | null;
  variantTitle: string | null;
  quantity: number;
  image: ImageRef | null;
}
export interface AccountOrder {
  id: string;
  name: string | null;
  processedAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  statusPageUrl: string | null;
  totalPrice: Money | null;
  lineItems: { nodes: AccountOrderLine[] };
}
export interface OrderDetailLine extends AccountOrderLine {
  id: string;
  name: string | null;
  sku: string | null;
  price: Money | null;
  totalPrice: Money | null;
  suggestedReturnReasonDefinitions: { nodes: { id: string; name: string | null; handle: string | null }[] };
}
export interface Fulfillment {
  id: string | null;
  status: string | null;
  createdAt: string | null;
  estimatedDeliveryAt: string | null;
  latestShipmentStatus: string | null;
  trackingInformation: { company: string | null; number: string | null; url: string | null }[];
}
/** One order in full, as Tether.account.order() answers it. */
export interface OrderDetail {
  id: string;
  name: string | null;
  number: number | null;
  processedAt: string | null;
  cancelledAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  statusPageUrl: string | null;
  requiresShipping: boolean | null;
  totalPrice: Money | null;
  subtotal: Money | null;
  totalShipping: Money | null;
  totalTax: Money | null;
  shippingAddress: MailingAddress | null;
  billingAddress: MailingAddress | null;
  lineItems: { nodes: OrderDetailLine[] };
  fulfillments: { nodes: Fulfillment[] };
  returnInformation: { returnableLineItems: { nodes: { quantity: number; lineItem: { id: string } | null }[] } } | null;
  returns: { nodes: { id: string; status: string | null }[] };
}
export interface SubscriptionLine {
  id: string | null;
  name: string | null;
  title: string | null;
  variantTitle: string | null;
  quantity: number;
  sku: string | null;
  currentPrice: Money | null;
  lineDiscountedPrice: Money | null;
  image: ImageRef | null;
}
export interface SubscriptionContract {
  id: string;
  /** ACTIVE, PAUSED, CANCELLED, EXPIRED or FAILED. */
  status: string | null;
  nextBillingDate: string | null;
  currencyCode: string | null;
  deliveryPrice: Money | null;
  deliveryPolicy: { interval: string | null; intervalCount: { count: number } | null } | null;
  lines: { nodes: SubscriptionLine[] };
  upcomingBillingCycles: {
    nodes: { cycleIndex: number | null; skipped: boolean; billingAttemptExpectedDate: string | null }[];
  };
}
