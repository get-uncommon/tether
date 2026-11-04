// Type definitions for @occluze/tether
// Shopify Storefront API objects are typed loosely (`ShopifyProduct` etc.): Tether passes them
// through as Shopify returns them. See https://shopify.dev/docs/api/storefront for the full shape.

export interface Money { amount: string; currencyCode: string }
export interface ShopifyImage { url: string; altText?: string | null; width?: number; height?: number }

export interface ShopifySellingPlan {
  id: string;
  name: string;
  description?: string | null;
  recurringDeliveries?: boolean;
  options: { name: string; value: string }[];
  priceAdjustments: unknown[];
  /** Added by Tether: the plan's group. */
  group?: { name: string; [k: string]: unknown };
}

export interface ShopifyVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  currentlyNotInStock?: boolean;
  quantityAvailable?: number | null;
  sku?: string | null;
  barcode?: string | null;
  selectedOptions: { name: string; value: string }[];
  image?: ShopifyImage | null;
  price: Money;
  compareAtPrice?: Money | null;
  unitPrice?: Money | null;
  sellingPlanAllocations?: { nodes: unknown[] };
  [k: string]: unknown;
}

export interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  productType?: string;
  vendor?: string;
  tags: string[];
  availableForSale: boolean;
  requiresSellingPlan?: boolean;
  featuredImage?: ShopifyImage | null;
  images: { nodes: ShopifyImage[] };
  priceRange: { minVariantPrice: Money; maxVariantPrice: Money };
  options: { name: string; optionValues: { name: string; swatch?: unknown }[] }[];
  variants: { nodes: ShopifyVariant[] };
  sellingPlanGroups?: { nodes: unknown[] };
  metafields?: ({ namespace: string; key: string; type: string; value: string; reference?: unknown } | null)[];
  seo?: { title?: string | null; description?: string | null };
  onlineStoreUrl?: string | null;
  [k: string]: unknown;
}

export interface ShopifyCartLine {
  id: string;
  quantity: number;
  merchandise: ShopifyVariant & { product: Pick<ShopifyProduct, 'id' | 'handle' | 'title'> & Record<string, unknown> };
  sellingPlanAllocation?: { sellingPlan: { id: string; name: string } } | null;
  attributes?: { key: string; value: string }[];
  cost: { totalAmount: Money; subtotalAmount: Money; amountPerQuantity: Money; compareAtAmountPerQuantity?: Money | null };
  [k: string]: unknown;
}

export interface ShopifyCart {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  note?: string | null;
  lines: { nodes: ShopifyCartLine[] };
  cost: Record<string, Money | null | undefined>;
  discountCodes: { code: string; applicable: boolean }[];
  attributes: { key: string; value: string }[];
  buyerIdentity?: { countryCode?: string | null; email?: string | null };
  [k: string]: unknown;
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
    shopify?: boolean | { consent?: 'no-banner' | 'default-banner' | 'custom-banner'; proxy?: string };
    onEvent?: (name: string, data: Record<string, unknown>) => void;
  } | null;
  /** Customer accounts (optional part): the Headless channel's Customer Account API client id, and options. */
  account?: {
    clientId: string;
    /** The page Shopify sends the visitor back to after login (registered as callback URI). Default: the current page. */
    callbackUrl?: string;
    /** Where Shopify sends the visitor after logout (registered as logout URI). Default: the home page. */
    logoutUrl?: string;
    /** Keep the login across tabs and browser restarts (localStorage instead of sessionStorage). */
    remember?: boolean;
    /** Your own token endpoint, if the browser can't call Shopify's (it forwards the form body). */
    tokenUrl?: string;
    /** The *.myshopify.com domain, if domain is something else. */
    shopDomain?: string;
    locale?: string;
  } | null;
  /** tether-show="low-stock" at this many or fewer (default 5). */
  lowStock?: number;
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
  /** Every failure that reaches the visitor. Send it to Sentry or similar. */
  onError?: ((error: TetherError | Error, context: string) => void) | null;
  debug?: boolean;
}

export type TetherErrorCode = 'NOT_FOUND' | 'NETWORK' | 'NOT_CONFIGURED' | 'INVALID_COUNTRY' | 'ERROR' | `HTTP_${number}`;

export declare class TetherError extends Error {
  name: 'TetherError';
  code: TetherErrorCode | string;
  status?: number;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
  userErrors?: { field?: string[]; message: string }[];
  constructor(message: string, opts?: { status?: number; errors?: unknown[]; userErrors?: unknown[]; code?: string });
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
export interface CartWarning { code: string; message: string; target?: string }

export interface Cart {
  readonly state: ShopifyCart | null;
  readonly lines: ShopifyCartLine[];
  readonly count: number;
  lastError: Error | null;
  /** Shopify's notes on the last change, e.g. less stock than asked (code MERCHANDISE_NOT_ENOUGH_STOCK). */
  readonly warnings: CartWarning[];
  /** true once the saved cart (or the absence of one) is known. */
  readonly loaded: boolean;
  id(): string | null;
  init(): Promise<ShopifyCart | null>;
  /** add(variantId, qty) · add({ variantId, quantity, sellingPlanId, attributes }) · add([line, line]) */
  add(input: string | LineInput | LineInput[], quantity?: number, opts?: Omit<LineInput, 'variantId' | 'quantity'>): Promise<ShopifyCart>;
  /** updateLine(id, 3) · updateLine(id, { sellingPlanId: null }) switches to one-time. */
  updateLine(lineId: string, patch: number | (LineInput & { quantity?: number })): Promise<ShopifyCart>;
  removeLine(lineIds: string | string[]): Promise<ShopifyCart>;
  /** +1 / -1 for a line; quick clicks add up and show at once (use it for your own +/- buttons). */
  changeQuantity(lineId: string, delta: number): Promise<ShopifyCart | null>;
  /** The quantity to show for a line: what the visitor asked for while an update is on its way. */
  quantityOf(line: ShopifyCartLine): number;
  clear(): Promise<ShopifyCart | null>;
  setNote(note: string): Promise<ShopifyCart>;
  setAttributes(attributes: Attributes): Promise<ShopifyCart>;
  setDiscountCodes(codes: string[]): Promise<ShopifyCart>;
  /** Rejects with code INVALID_DISCOUNT (and doesn't keep the code) when Shopify doesn't accept it. */
  applyDiscount(code: string): Promise<ShopifyCart>;
  removeDiscount(code: string): Promise<ShopifyCart>;
  setBuyerIdentity(identity: { countryCode?: string; email?: string; phone?: string }, opts?: { create?: boolean }): Promise<ShopifyCart | null>;
  checkout(target?: '_self' | '_blank'): Promise<void>;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  drawers(): HTMLElement[];
  render(): void;
  /** For framework islands: fn(cart, meta) now, when the saved cart has loaded and after every change. Returns unsubscribe. */
  subscribe(fn: (cart: ShopifyCart | null, meta: { open: boolean; count: number; loaded: boolean; warnings: CartWarning[] }) => void): () => void;
}

export interface ProductScope {
  readonly root: HTMLElement;
  product: ShopifyProduct;
  variant: ShopifyVariant | null;
  selected: Record<string, string>;
  quantity: number;
  plans: ShopifySellingPlan[];
  purchase: 'one-time' | 'subscription';
  planId: string | null;
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

export interface SellingPlanHelpers {
  allPlans(product: ShopifyProduct): ShopifySellingPlan[];
  hasPlans(product: ShopifyProduct): boolean;
  allocationFor(variant: ShopifyVariant, planId: string | null): unknown | null;
  plansForVariant(product: ShopifyProduct, variant: ShopifyVariant): ShopifySellingPlan[];
  planPrice(variant: ShopifyVariant, planId: string): Money | null;
  planCheckoutCharge(variant: ShopifyVariant, planId: string): Money | null;
  planSavings(variant: ShopifyVariant, planId: string): { amount: Money | null; percentage: number };
  planAdjustment(plan: ShopifySellingPlan | null | undefined): { type: 'percentage' | 'amount' | 'price'; value: number | Money } | null;
  findPlan(product: ShopifyProduct, ref: string | null | undefined): ShopifySellingPlan | null;
  toGid(value: string | number, type: string): string | null;
  GID: { product(v: string | number): string | null; variant(v: string | number): string | null; sellingPlan(v: string | number): string | null };
}

export interface ProductPage {
  collection: Record<string, unknown> | null;
  products: ShopifyProduct[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface Localization {
  country?: { isoCode: string; name: string; currency?: { isoCode: string; symbol: string } };
  language?: { isoCode: string; name: string };
  availableCountries: { isoCode: string; name: string; currency?: { isoCode: string; symbol: string }; availableLanguages?: { isoCode: string; name: string }[] }[];
}

export interface DiagnoseReport {
  version: string;
  config: Record<string, unknown>;
  apiVersion: { version: string; ok: boolean; monthsLeft?: number; next?: string; note: string };
  market: { country?: string; language?: string; locale?: string; sources: Record<string, string> } | null;
  reachable: boolean;
  shop: { name?: string; url?: string; currency?: string } | null;
  latencyMs: number | null;
  products: { key: string; handle?: string; title?: string; plans?: number; error?: string }[];
  sellingPlans: { product: string; group?: string; plan: string; id: string }[];
  problems: { level: 'error' | 'warn'; message: string; element?: string }[];
}

/** Events on document, as `tether:<name>` (or your prefix). Detail types for Tether.on(). */
export interface TetherEvents {
  ready: { cart: ShopifyCart | null };
  'product-ready': { product: ShopifyProduct; scope: ProductScope };
  'product-updated': { product: ShopifyProduct; scope: ProductScope };
  'product-not-found': { key: string | null; source: string };
  'variant-changed': { product: ShopifyProduct; variant: ShopifyVariant; selected: Record<string, string>; purchase: 'one-time' | 'subscription'; sellingPlanId: string | null };
  'product-added': { product: ShopifyProduct; variant: ShopifyVariant; line: LineInput };
  added: { cart: ShopifyCart; lines: LineInput[] };
  'group-added': { group: string | null; lines: LineInput[] };
  'cart-warning': { warnings: CartWarning[] };
  'cart-updated': { cart: ShopifyCart | null; reason: string };
  'cart-toggled': { open: boolean };
  'cart-error': { error: Error };
  checkout: { url: string; cart: ShopifyCart };
  'list-ready': { products: ShopifyProduct[]; collection: Record<string, unknown> | null };
  'country-changed': { country: string; language?: string };
  'discount-applied': { code: string };
  'discount-invalid': { code: string };
  'layout-changed': { reason: string };
  error: { error: Error; context: string; key?: string };
}

export interface Tether {
  readonly VERSION: string;
  /** Configure (window.TETHER_CONFIG + overrides) and load the cart. */
  init(overrides?: Partial<TetherConfig>): Promise<Tether | null>;
  /** Mount product scopes and lists inside root (call per page container with Barba/Swup). */
  mount(root?: ParentNode): number;
  /** Call before a page transition removes the page (closes the cart drawer). */
  unmount(): void;
  readonly config: TetherConfig;
  readonly ready: Promise<Tether | null>;
  /** Any Storefront API query, with @inContext added for the current market. */
  query<T = any>(query: string, variables?: Record<string, unknown>, opts?: { context?: boolean }): Promise<T>;
  withContext(query: string, ctx?: { country?: string; language?: string }): string;
  cart: Cart;
  getProduct(handleOrId: string): Promise<ShopifyProduct>;
  getProducts(opts?: { collection?: string; query?: string; first?: number; after?: string | null; sortKey?: string; reverse?: boolean; filters?: unknown[] }): Promise<ProductPage>;
  getRecommendations(product: string | Pick<ShopifyProduct, 'id'>, intent?: 'RELATED' | 'COMPLEMENTARY'): Promise<ShopifyProduct[]>;
  getScope(el: Element | null | undefined): ProductScope | null;
  addGroup(button: Element): Promise<ShopifyCart | null>;
  /** Customer accounts (loads the account part): login(), logout(), customer(), orders(), query(gql, vars), getToken(). */
  account: {
    login(opts?: { returnTo?: string; locale?: string }): Promise<void>;
    logout(opts?: { returnTo?: string }): Promise<void>;
    customer(): Promise<{ id: string; firstName?: string | null; lastName?: string | null; displayName?: string; emailAddress?: { emailAddress: string } | null } | null>;
    orders(opts?: { first?: number }): Promise<Array<{ id: string; name: string; processedAt: string; financialStatus?: string; fulfillmentStatus?: string; statusPageUrl: string; totalPrice: Money }>>;
    query<T = any>(query: string, variables?: Record<string, unknown>): Promise<T>;
    getToken(): Promise<string | null>;
  };
  primeProduct(product: ShopifyProduct): void;
  normalizeProductKey(raw: string | number): string | null;
  clearProductCache(): void;
  formatMoney(money: Money | null | undefined): string;
  /** Shopify CDN image at a size: imageUrl(line.merchandise.image?.url, { width: 160 }). */
  imageUrl(url: string | null | undefined, size?: { width?: number; height?: number; crop?: string }): string;
  plans: SellingPlanHelpers;
  TetherError: typeof TetherError;
  resolveProductKey(el: Element, location?: Location | URL): { key: string | null; fromUrl: boolean; raw: string };
  /** Switch market: prices, currency, cart and every product on the page follow. */
  setCountry(code: string, opts?: SetCountryOptions): Promise<ShopifyCart | null>;
  detectMarket(markets?: MarketsConfig): Promise<{ country?: string; language?: string; locale?: string; sources: Record<string, string> }>;
  getLocalization(): Promise<Localization>;
  /** Logs and returns what's wrong on this page (config, token, API version, plans, markup). */
  diagnose(opts?: { root?: ParentNode; silent?: boolean }): Promise<DiagnoseReport>;
  /** Listen to a Tether event; returns a function that stops listening. */
  on<K extends keyof TetherEvents>(name: K, fn: (detail: TetherEvents[K], event: CustomEvent<TetherEvents[K]>) => void): () => void;
  on(name: string, fn: (detail: any, event: CustomEvent) => void): () => void;
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
