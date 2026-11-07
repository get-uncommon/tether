/**
 * The runtime configuration. `cfg` is one shared object that every browser module imports; `configure()` replaces its
 * contents in place, so those imports see the new values, and `setCountry()` changes its market keys the same way.
 * Every option is validated here, once, where it arrives: values that end up in query text, URLs, attribute names or
 * storage keys never reach the code that uses them unchecked.
 */
import { STOREFRONT_API_VERSION } from '../server/src/shared/api-versions.ts';
import { isQuarterlyVersion } from './api-version.ts';
import {
  accountOption,
  analyticsOption,
  domainOption,
  embedOriginsOption,
  marketsOption,
  metafieldsOption,
  partsUrlOption,
} from './config-sections.ts';

export { MARKET_SOURCES } from './config-sections.ts';
import { toCountry, toLanguage } from './market-codes.ts';
import type { ApiVersion } from '../server/src/shared/api-versions.ts';
import type { ShopDomain } from './config-sections.ts';
import { MAX_CONNECTION_SIZE } from './shopify-values.ts';
import type { Money } from './shopify-values.ts';
import type { CountryCode, LanguageCode } from './market-codes.ts';

/** Where the visitor's market comes from (`markets.ts`). */
export interface MarketsConfig {
  /** True: every source; a list: only those. */
  detect?: boolean | ('saved' | 'server' | 'webflow')[];
  /** Webflow locale (subdirectory or html lang) to market. */
  locales?: Record<string, { country?: string; language?: string; locale?: string }>;
  /** The cookie a server sets with the visitor's country. */
  cookie?: string;
  /** Remember the visitor's choice (default true). */
  remember?: boolean;
  /** With `locales`: ignore an html lang that isn't in the map. */
  strict?: boolean;
}

/** The optional analytics part. */
export interface AnalyticsConfig {
  /** GA4/GTM events, into `window.dataLayer` or the named array. */
  dataLayer?: boolean | string;
  /** Shopify's own analytics. `proxy`: the site serves the Storefront API on its own domain. */
  shopify?: boolean | { consent?: 'no-banner' | 'default-banner' | 'custom-banner'; proxy?: boolean };
  onEvent?: (name: string, data: Record<string, unknown>) => void;
}

/** The optional customer accounts part, which runs through the site's Worker. */
export interface AccountConfig {
  /** The Worker's account routes, a URL or a path on this site. */
  server: string;
  /** The site's own order page, with `{id}` for the numeric order id. */
  orderUrl?: string;
  /** Shopify's subscription management page. */
  subscriptionsUrl?: string;
  /** A separate page for payment methods (default `subscriptionsUrl`). */
  paymentUrl?: string;
  /** Where Shopify sends the visitor after logout (default the home page). */
  logoutUrl?: string;
  /** The language of Shopify's login pages. */
  locale?: string;
  /** Replaces `location.assign` for the login redirect (popups, tests). */
  navigate?: (url: string) => void;
}

export interface MetafieldIdentifier {
  namespace: string;
  key: string;
}
/** `'namespace.key'` or the identifier itself. */
export type MetafieldRef = string | MetafieldIdentifier;
/** Shopify's note on a cart change. */
export interface CartWarning {
  code: string;
  message: string;
  target?: string;
}
export type CheckoutTarget = '_self' | '_blank';
type PurchaseKind = 'one-time' | 'subscription';

/** Every option, with its default filled in. */
export interface TetherConfig {
  /** The store's domain, without protocol or path; `''` until one is set. */
  domain: ShopDomain | '';
  /** The public Storefront API access token. */
  token: string;
  /** A dated Shopify API version (or `unstable`, with a warning). */
  apiVersion: ApiVersion | 'unstable';
  /** The market's country, for `@inContext(country:)`. */
  country: CountryCode | undefined;
  /** The market's language, for `@inContext(language:)`. */
  language: LanguageCode | undefined;
  /** An `Intl` locale for money and dates. */
  locale: string | undefined;
  markets: MarketsConfig | null;
  /** The attribute prefix: `tether` reads `tether-product`, `tether-bind`. */
  prefix: string;
  /** A folder (`/product`) or a template with `{handle}` / `{id}`. */
  productPath: string;
  collectionPath: string;
  /** The product metafields to fetch. */
  metafields: MetafieldRef[];
  /** Origins (`https://video.example`) a description's iframes may load from, besides the built-in video players. */
  embedOrigins: string[];
  imagesFirst: number;
  variantsFirst: number;
  sellingPlanGroupsFirst: number;
  sellingPlansFirst: number;
  collectionFirst: number;
  /**
   * How many times a failed request is sent again. A query is retried after a network error (no answer, or a body that
   * stopped arriving), a 429, a 5xx or Shopify's `THROTTLED`. A mutation, a cart change included, is retried only
   * after a 429 or `THROTTLED`, which Shopify sends without running it: after a network error or a 5xx it may
   * already have applied the change.
   */
  retries: number;
  /**
   * Milliseconds a Storefront request may take, its body included, before it counts as a network error (0: no limit;
   * at most 2147483647, the longest delay a timer keeps). A query is then retried; a mutation isn't, and a cart change
   * loads the cart again.
   */
  requestTimeout: number;
  /** Refresh server-rendered products once in the background. */
  revalidate: boolean;
  /** The localStorage key of the cart id (default `<prefix>:cart:<domain>`). */
  storageKey: string;
  cartDrawerOpenClass: string;
  openCartOnAdd: boolean;
  /** Move focus into the open cart, keep Tab inside it, restore it on close. */
  cartFocus: boolean;
  checkoutTarget: CheckoutTarget;
  defaultPurchase: PurchaseKind;
  /** `?variant=` follows the visitor's choice on the page's main product. */
  variantUrl: boolean;
  /** Seconds a Shopify answer may be cached; 0 leaves it to Shopify, which can be hours. */
  maxAge: number;
  /** `tether-show="low-stock"` at this many or fewer (needs inventory access). */
  lowStock: number;
  /** Milliseconds the search part waits after the last keystroke. */
  searchDelay: number;
  /** Mount the document on DOMContentLoaded. */
  autoMount: boolean;
  /** Mount elements added later (CMS load more, filters). */
  observe: boolean;
  /** Mount on Astro's `astro:page-load` and close the cart on navigation. */
  astro: boolean;
  /** The folder of the optional parts, for the `<script>` build. */
  partsUrl: string | null;
  analytics: AnalyticsConfig | null;
  account: AccountConfig | null;
  /** The site's text for a cart warning; nothing keeps Shopify's. */
  warningText: ((warning: CartWarning) => string | null | undefined) | null;
  formatMoney: ((money: Money, locale: string | undefined) => string) | null;
  /** Default: `ScrollTrigger.refresh()` when present. */
  onLayoutChange: ((reason: string) => void) | null;
  onCartOpen: ((drawers: HTMLElement[]) => void) | null;
  onCartClose: ((drawers: HTMLElement[]) => void) | null;
  onLineEnter: ((node: HTMLElement) => void) | null;
  /** Animates a line out, then calls `done()`. */
  onLineLeave: ((node: HTMLElement, done: () => void) => void) | null;
  onValueChange: ((element: HTMLElement, previousText: string) => void) | null;
  /** Every failure that reaches the visitor. */
  onError: ((error: unknown, context: string) => void) | null;
  debug: boolean;
}

/** The options a site writes as plain text, which `resolveConfig` checks into their typed form. */
type ParsedFromText = 'domain' | 'apiVersion' | 'country' | 'language' | 'storageKey';

/**
 * What a site passes: any option, the market as the codes people write (`'de'`, `'pt-BR'`), and `null` for the
 * default storage key.
 */
export type TetherOptions = {
  [Key in Exclude<keyof TetherConfig, ParsedFromText>]?: TetherConfig[Key];
} & Partial<Record<Exclude<ParsedFromText, 'storageKey'>, string | undefined>> & {
    storageKey?: string | null | undefined;
  };

export const DEFAULTS: Readonly<TetherConfig> = {
  domain: '',
  token: '',
  apiVersion: STOREFRONT_API_VERSION,
  country: undefined,
  language: undefined,
  locale: undefined,
  markets: null,
  prefix: 'tether',
  productPath: '/product',
  collectionPath: '/collection',
  metafields: [],
  embedOrigins: [],
  imagesFirst: 25,
  variantsFirst: 100,
  sellingPlanGroupsFirst: 10,
  sellingPlansFirst: 25,
  collectionFirst: 24,
  retries: 2,
  requestTimeout: 15_000,
  revalidate: true,
  storageKey: '',
  cartDrawerOpenClass: 'is-open',
  openCartOnAdd: true,
  cartFocus: true,
  checkoutTarget: '_self',
  defaultPurchase: 'one-time',
  variantUrl: false,
  maxAge: 60,
  lowStock: 5,
  searchDelay: 150,
  autoMount: true,
  observe: false,
  astro: true,
  partsUrl: null,
  analytics: null,
  account: null,
  warningText: null,
  formatMoney: null,
  onLayoutChange: null,
  onCartOpen: null,
  onCartClose: null,
  onLineEnter: null,
  onLineLeave: null,
  onValueChange: null,
  onError: null,
  debug: false,
};

export const cfg: TetherConfig = { ...DEFAULTS };

function refuseChange(key: string | symbol): false {
  warn(`Tether.config is read-only (${String(key)}): pass options to Tether.init() instead`);
  return false;
}

/** Each config object's read-only view, made once, so reading the same object twice gives the same view. */
const readOnlyViews = new WeakMap<object, object>();

/**
 * Reads the live values, each object among them through its own view, and refuses every change: a write throws in
 * strict-mode code (as on a frozen object) and warns in any code.
 */
const READ_ONLY: ProxyHandler<object> = {
  get: (object, key) => viewOf(Reflect.get(object, key)),
  // A descriptor's value is the view too, so `Object.getOwnPropertyDescriptor` doesn't hand out the live object.
  getOwnPropertyDescriptor(object, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
    if (descriptor) descriptor.value = viewOf(descriptor.value);
    return descriptor;
  },
  set: (_object, key) => refuseChange(key),
  deleteProperty: (_object, key) => refuseChange(key),
  defineProperty: (_object, key) => refuseChange(key),
};

/** @returns An object's read-only view; any other value as it is. */
function viewOf(value: unknown): unknown {
  // The config's objects are its own copies (`resolveConfig`), never frozen and configurable, so a view of each is
  // allowed, in `get` and in a descriptor.
  return typeof value === 'object' && value !== null ? readOnlyView(value) : value;
}

/** @returns The read-only view of `target`, the same one on every call. */
function readOnlyView(target: object): object {
  let view = readOnlyViews.get(target);
  if (!view) {
    view = new Proxy(target, READ_ONLY);
    readOnlyViews.set(target, view);
  }
  return view;
}

/**
 * `cfg` as `Tether.config` shows it. A value written there would skip the validation `configure()` does, so the view
 * is read-only; `Tether.init(options)` is how a site changes the config.
 */
export const configView = new Proxy<TetherConfig>(cfg, READ_ONLY);

/** The prefix becomes part of attribute names, CSS selectors and event names, so it is kept to those characters. */
const PREFIX = /^[a-z][a-z0-9-]*$/;

type CountOption =
  | 'imagesFirst'
  | 'variantsFirst'
  | 'sellingPlanGroupsFirst'
  | 'sellingPlansFirst'
  | 'collectionFirst'
  | 'retries'
  | 'requestTimeout'
  | 'maxAge'
  | 'lowStock'
  | 'searchDelay';
type HookOption =
  | 'warningText'
  | 'formatMoney'
  | 'onLayoutChange'
  | 'onCartOpen'
  | 'onCartClose'
  | 'onLineEnter'
  | 'onLineLeave'
  | 'onValueChange'
  | 'onError';
type SwitchOption =
  'revalidate' | 'openCartOnAdd' | 'cartFocus' | 'variantUrl' | 'autoMount' | 'observe' | 'astro' | 'debug';
type TextOption = 'token' | 'productPath' | 'collectionPath';

const SWITCH_OPTIONS: readonly SwitchOption[] = [
  'revalidate',
  'openCartOnAdd',
  'cartFocus',
  'variantUrl',
  'autoMount',
  'observe',
  'astro',
  'debug',
];
const TEXT_OPTIONS: readonly TextOption[] = ['token', 'productPath', 'collectionPath'];

/** Options that are written into queries as list sizes or used as counts. */
const COUNT_OPTIONS: readonly CountOption[] = [
  'imagesFirst',
  'variantsFirst',
  'sellingPlanGroupsFirst',
  'sellingPlansFirst',
  'collectionFirst',
  'retries',
  'requestTimeout',
  'maxAge',
  'lowStock',
  'searchDelay',
];
const HOOK_OPTIONS: readonly HookOption[] = [
  'warningText',
  'formatMoney',
  'onLayoutChange',
  'onCartOpen',
  'onCartClose',
  'onLineEnter',
  'onLineLeave',
  'onValueChange',
  'onError',
];

/** @returns `fallback`, with a warning unless `value` was left out. */
function invalidOption<T>(name: string, value: unknown, fallback: T): T {
  if (value !== undefined) warn(`invalid ${name} ${JSON.stringify(value)}: using ${JSON.stringify(fallback)}`);
  return fallback;
}

/** Warns about an option without a default to fall back to, which is left out (`config-sections.ts` too). */
function dropped(name: string, value: unknown): void {
  warn(`invalid ${name} ${JSON.stringify(value)}: ignored`);
}

/**
 * Warns about each key that is no option, so a misspelt one (`openCartOnAd`) is seen; none of them reaches `cfg`.
 */
function warnUnknownKeys(options: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(options)) {
    if (!Object.hasOwn(DEFAULTS, key)) warn(`unknown option ${JSON.stringify(key)}: ignored`);
  }
}

/** Sets the site's function for option `name`; a value that isn't one is dropped with a warning, unless it is null. */
function setHook<Name extends HookOption>(config: Pick<TetherConfig, Name>, name: Name, value: unknown): void {
  if (typeof value === 'function') {
    // A function from the site can only be checked for being callable; how it is called is the documented signature
    // of its option.
    config[name] = value as TetherConfig[Name];
  } else if (value !== undefined && value !== null) {
    dropped(name, value);
  }
}

/** The longest delay `setTimeout` keeps: browsers and Node fire a longer one after 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * The most retries a request gets: with the client's capped backoff, ten already wait two to three minutes in all,
 * and more would only keep a failing page sending.
 */
const MAX_RETRIES = 10;

/** A count option's integers: from `min` (0 when left out) up to `max` (no limit when left out). */
interface CountRange {
  min?: number;
  max?: number;
}

/** A connection's `first` asks for at least one node: no variants would leave a product nothing to show. */
const CONNECTION_RANGE: CountRange = { min: 1, max: MAX_CONNECTION_SIZE };

/**
 * The bounded count options' ranges; the others take any non-negative integer. An integer above the maximum is the
 * site asking for as much as there is, so it gets the maximum.
 */
const COUNT_RANGES: Partial<Readonly<Record<CountOption, CountRange>>> = {
  imagesFirst: CONNECTION_RANGE,
  variantsFirst: CONNECTION_RANGE,
  sellingPlanGroupsFirst: CONNECTION_RANGE,
  sellingPlansFirst: CONNECTION_RANGE,
  collectionFirst: CONNECTION_RANGE,
  requestTimeout: { max: MAX_TIMER_MS },
  searchDelay: { max: MAX_TIMER_MS },
  retries: { max: MAX_RETRIES },
};

/**
 * @returns `value` when it is an integer from the option's minimum, capped at its maximum with a warning; the
 *   default, with a warning, for anything else.
 */
function countOption(name: CountOption, value: unknown): number {
  const { min = 0, max: maximum } = COUNT_RANGES[name] ?? {};
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    return invalidOption(name, value, DEFAULTS[name]);
  }
  if (maximum === undefined || value <= maximum) return value;
  warn(`${name} ${String(value)} is more than its maximum: using ${String(maximum)}`);
  return maximum;
}

function switchOption(name: SwitchOption, value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalidOption(name, value, DEFAULTS[name]);
}

function textOption(name: TextOption, value: unknown): string {
  return typeof value === 'string' ? value : invalidOption(name, value, DEFAULTS[name]);
}

/** One `classList` token: `DOMTokenList.add` throws for an empty one or one with whitespace. */
const CLASS_TOKEN = /^\S+$/;

function classOption(name: 'cartDrawerOpenClass', value: unknown): string {
  return typeof value === 'string' && CLASS_TOKEN.test(value) ? value : invalidOption(name, value, DEFAULTS[name]);
}

/** @returns An `Intl` locale as written, `undefined` for one `Intl` doesn't accept. */
function localeOption(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    if (typeof value === 'string' && Intl.getCanonicalLocales(value).length) return value;
  } catch {
    // RangeError: not a locale (falls through to the warning).
  }
  dropped('locale', value);
  return undefined;
}

/** @param choices The first one is the default. */
function choiceOption<Choice extends string>(
  name: string,
  value: unknown,
  choices: readonly [Choice, ...Choice[]],
): Choice {
  return choices.find((choice) => choice === value) ?? invalidOption(name, value, choices[0]);
}

/**
 * @returns A quarterly version, or `unstable` with a warning; the default for anything else, which would be written
 *   into the endpoint's path.
 */
function apiVersionOption(value: unknown): ApiVersion | 'unstable' {
  if (value === 'unstable') {
    warn('apiVersion "unstable" changes without notice. Pin a dated version (e.g. 2026-07).');
    return value;
  }
  return isQuarterlyVersion(value) ? value : invalidOption('apiVersion', value, DEFAULTS.apiVersion);
}

function codeOption<Code>(name: string, value: unknown, parse: (value: unknown) => Code | null): Code | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const code = parse(value);
  if (code !== null) return code;
  dropped(name, value);
  return undefined;
}

/**
 * The configuration `options` describe: defaults filled in, every value validated (an invalid one warns and falls
 * back to its default), hooks that aren't functions dropped so callers only check for null.
 *
 * @param options What the site set, or any object (the server helpers take their options from code and `.env`).
 */
export function resolveConfig(options: TetherOptions | Readonly<Record<string, unknown>>): TetherConfig {
  warnUnknownKeys(options);
  const domain = domainOption(options.domain, dropped);
  const prefix =
    typeof options.prefix === 'string' && PREFIX.test(options.prefix)
      ? options.prefix
      : invalidOption('prefix', options.prefix, DEFAULTS.prefix);
  const resolved: TetherConfig = {
    ...DEFAULTS,
    domain,
    apiVersion: apiVersionOption(options.apiVersion),
    country: codeOption('country', options.country, toCountry),
    locale: localeOption(options.locale),
    partsUrl: partsUrlOption(options.partsUrl, dropped),
    language: codeOption('language', options.language, toLanguage),
    markets: marketsOption(options.markets, dropped),
    analytics: analyticsOption(options.analytics, dropped),
    account: accountOption(options.account, dropped, warn),
    prefix,
    storageKey:
      typeof options.storageKey === 'string' && options.storageKey ? options.storageKey : `${prefix}:cart:${domain}`,
    metafields: metafieldsOption(options.metafields ?? [], dropped),
    embedOrigins: embedOriginsOption(options.embedOrigins ?? [], dropped),
    checkoutTarget: choiceOption('checkoutTarget', options.checkoutTarget, ['_self', '_blank']),
    defaultPurchase: choiceOption('defaultPurchase', options.defaultPurchase, ['one-time', 'subscription']),
    cartDrawerOpenClass: classOption('cartDrawerOpenClass', options.cartDrawerOpenClass),
  };
  for (const name of COUNT_OPTIONS) resolved[name] = countOption(name, options[name]);
  for (const name of SWITCH_OPTIONS) resolved[name] = switchOption(name, options[name]);
  for (const name of TEXT_OPTIONS) resolved[name] = textOption(name, options[name]);
  for (const name of HOOK_OPTIONS) setHook(resolved, name, options[name]);
  return resolved;
}

/**
 * @param value A `markets` option from code other than the config (`Tether.detectMarket(markets)`).
 * @returns It validated as the config's own is, with the same warnings.
 */
export const parseMarkets = (value: unknown): MarketsConfig | null => marketsOption(value, dropped);

/**
 * Replaces the shared configuration with `options` over the defaults (see `resolveConfig`).
 *
 * @returns The shared `cfg`.
 */
export function configure(options: TetherOptions | Readonly<Record<string, unknown>> = {}): TetherConfig {
  const resolved = resolveConfig(options);
  for (const key of Object.keys(cfg)) {
    if (!(key in resolved)) Reflect.deleteProperty(cfg, key);
  }
  return Object.assign(cfg, resolved);
}

/** @returns True once a domain and a token are set. */
export const isConfigured = (): boolean => Boolean(cfg.domain && cfg.token);

export function log(...args: unknown[]): void {
  if (cfg.debug) console.log(`[${cfg.prefix}]`, ...args);
}

export function warn(...args: unknown[]): void {
  console.warn(`[${cfg.prefix}]`, ...args);
}

/**
 * Logs a failure that reaches the visitor and hands it to `onError`. A throwing `onError` is logged, never rethrown:
 * the site's hook must not break the render that reported the failure.
 *
 * @param context What failed, e.g. `product coffee-box`.
 */
export function reportError(error: unknown, context: string): void {
  warn(context, error instanceof Error && error.message ? error.message : error);
  if (!cfg.onError) return;
  try {
    cfg.onError(error, context);
  } catch (hookError) {
    warn('onError threw', hookError);
  }
}

/** The hook failures reported so far, as `<hook>: <message>`. */
const reportedHookFailures = new Set<string>();

/**
 * Calls one of the site's hooks. A bug in it is reported under `name`, and `fallback` answers instead, so the site's
 * code never fails the render, or the cart change Shopify already applied, that called it. A thrown `Error` is reported
 * once per page load for each message (a `formatMoney` runs for every price on every render). Anything else thrown is
 * reported each time: it has no message, and turning it into text can throw too.
 */
export function callHook(name: string, hook: () => unknown): void;
export function callHook<T>(name: string, hook: () => T, fallback: () => T): T;
export function callHook(name: string, hook: () => unknown, fallback?: () => unknown): unknown {
  try {
    return hook();
  } catch (error) {
    const failure = error instanceof Error && `${name}: ${error.message}`;
    if (!failure || !reportedHookFailures.has(failure)) {
      if (failure) reportedHookFailures.add(failure);
      reportError(error, name);
    }
    return fallback?.();
  }
}
