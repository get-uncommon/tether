export { MARKET_SOURCES } from './config-sections.js';
import type { ApiVersion } from '../server/src/shared/api-versions.js';
import type { ShopDomain } from './config-sections.js';
import type { Money } from './shopify-values.js';
import type { CountryCode, LanguageCode } from './market-codes.js';
/** Where the visitor's market comes from (`markets.ts`). */
export interface MarketsConfig {
    /** True: every source; a list: only those. */
    detect?: boolean | ('saved' | 'server' | 'webflow')[];
    /** Webflow locale (subdirectory or html lang) to market. */
    locales?: Record<string, {
        country?: string;
        language?: string;
        locale?: string;
    }>;
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
    shopify?: boolean | {
        consent?: 'no-banner' | 'default-banner' | 'custom-banner';
        proxy?: boolean;
    };
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
export declare const DEFAULTS: Readonly<TetherConfig>;
export declare const cfg: TetherConfig;
/**
 * `cfg` as `Tether.config` shows it. A value written there would skip the validation `configure()` does, so the view
 * is read-only; `Tether.init(options)` is how a site changes the config.
 */
export declare const configView: TetherConfig;
/**
 * The configuration `options` describe: defaults filled in, every value validated (an invalid one warns and falls
 * back to its default), hooks that aren't functions dropped so callers only check for null.
 *
 * @param options What the site set, or any object (the server helpers take their options from code and `.env`).
 */
export declare function resolveConfig(options: TetherOptions | Readonly<Record<string, unknown>>): TetherConfig;
/**
 * @param value A `markets` option from code other than the config (`Tether.detectMarket(markets)`).
 * @returns It validated as the config's own is, with the same warnings.
 */
export declare const parseMarkets: (value: unknown) => MarketsConfig | null;
/**
 * Replaces the shared configuration with `options` over the defaults (see `resolveConfig`).
 *
 * @returns The shared `cfg`.
 */
export declare function configure(options?: TetherOptions | Readonly<Record<string, unknown>>): TetherConfig;
/** @returns True once a domain and a token are set. */
export declare const isConfigured: () => boolean;
export declare function log(...args: unknown[]): void;
export declare function warn(...args: unknown[]): void;
/**
 * Logs a failure that reaches the visitor and hands it to `onError`. A throwing `onError` is logged, never rethrown:
 * the site's hook must not break the render that reported the failure.
 *
 * @param context What failed, e.g. `product coffee-box`.
 */
export declare function reportError(error: unknown, context: string): void;
/**
 * Calls one of the site's hooks. A bug in it is reported under `name`, and `fallback` answers instead, so the site's
 * code never fails the render, or the cart change Shopify already applied, that called it. A thrown `Error` is reported
 * once per page load for each message (a `formatMoney` runs for every price on every render), for the first
 * `MAX_REMEMBERED_HOOK_FAILURES` messages. Anything else thrown is reported each time: it has no message, and turning
 * it into text can throw too.
 */
export declare function callHook(name: string, hook: () => unknown): void;
export declare function callHook<T>(name: string, hook: () => T, fallback: () => T): T;
