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
  [k: string]: unknown;
}

export interface ShopifyCartLine {
  id: string;
  quantity: number;
  merchandise: ShopifyVariant & { product: Pick<ShopifyProduct, 'id' | 'handle' | 'title'> & Record<string, unknown> };
  sellingPlanAllocation?: { sellingPlan: { id: string; name: string } } | null;
  attributes?: { key: string; value: string }[];
  cost: Record<string, Money | null | undefined>;
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

export interface Cart {
  readonly state: ShopifyCart | null;
  readonly lines: ShopifyCartLine[];
  readonly count: number;
  lastError: Error | null;
  id(): string | null;
  init(): Promise<ShopifyCart | null>;
  /** add(variantId, qty) · add({ variantId, quantity, sellingPlanId, attributes }) · add([line, line]) */
  add(input: string | LineInput | LineInput[], quantity?: number, opts?: Omit<LineInput, 'variantId' | 'quantity'>): Promise<ShopifyCart>;
  /** updateLine(id, 3) · updateLine(id, { sellingPlanId: null }) switches to one-time. */
  updateLine(lineId: string, patch: number | (LineInput & { quantity?: number })): Promise<ShopifyCart>;
  removeLine(lineIds: string | string[]): Promise<ShopifyCart>;
  clear(): Promise<ShopifyCart | null>;
  setNote(note: string): Promise<ShopifyCart>;
  setAttributes(attributes: Attributes): Promise<ShopifyCart>;
  setDiscountCodes(codes: string[]): Promise<ShopifyCart>;
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
  getRecommendations(productId: string, intent?: 'RELATED' | 'COMPLEMENTARY'): Promise<ShopifyProduct[]>;
  getScope(el: Element | null | undefined): ProductScope | null;
  addGroup(button: Element): Promise<ShopifyCart | null>;
  primeProduct(product: ShopifyProduct): void;
  normalizeProductKey(raw: string | number): string | null;
  clearProductCache(): void;
  formatMoney(money: Money | null | undefined): string;
  plans: SellingPlanHelpers;
  TetherError: typeof TetherError;
  resolveProductKey(el: Element, location?: Location | URL): { key: string | null; fromUrl: boolean; raw: string };
  /** Switch market: prices, currency, cart and every product on the page follow. */
  setCountry(code: string, opts?: { language?: string; remember?: boolean }): Promise<ShopifyCart | null>;
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
export declare function setCountry(code: string, opts?: { language?: string; remember?: boolean }): Promise<ShopifyCart | null>;
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
