import type { CartUpdateReason, ShopifyCart } from './cart/store.js';
import type { CartLineInput } from './cart/mutations.js';
import type { CartWarning } from './config.js';
import type { Product, ProductVariant } from './fragments.js';
import type { Collection } from './loader.js';
import type { ReadonlyProductScope } from './product.js';
import type { Purchase } from './product-state.js';
import type { SearchResults } from './search.js';
/** @returns The prefixed attribute name: `product` → `tether-product`. */
export declare const attr: (name: string) => string;
/** @returns A selector for the attribute, with that exact value when given. */
export declare const sel: (name: string, value?: string) => string;
export declare const get: (el: Element, name: string) => string | null;
export declare const has: (el: Element, name: string) => boolean;
/**
 * Tether's attributes go on HTML elements, so matches are typed as such. An SVG element that carries one still has
 * the `style`, `dataset` and attribute methods Tether uses.
 *
 * @returns The matches in `root`, none without a root.
 */
export declare function qsa(root: ParentNode | null | undefined, selector: string): HTMLElement[];
/** @returns Matches in `root` whose nearest `scopeSelector` ancestor is `root` itself, not a nested scope. */
export declare const scoped: (root: Element | null | undefined, selector: string, scopeSelector: string) => HTMLElement[];
/**
 * The events Tether dispatches, as `<prefix>:<name>` (`tether:cart-updated`), bubbling up to `document`, with the
 * detail each carries. `emit` takes only these, and `Tether.on()` passes on only the events `emit` dispatched, so a
 * listener gets the detail its event really has.
 */
export interface TetherEvents {
    ready: {
        cart: ShopifyCart | null;
    };
    'product-ready': {
        product: Product;
        scope: ReadonlyProductScope;
    };
    'product-updated': {
        product: Product;
        scope: ReadonlyProductScope;
    };
    /** `key` is null when the scope names no product; `source` is what it named. */
    'product-not-found': {
        key: string | null;
        source: string;
    };
    'variant-changed': {
        product: Product;
        variant: ProductVariant;
        selected: Record<string, string>;
        purchase: Purchase['kind'];
        sellingPlanId: string | null;
    };
    'product-added': {
        product: Product;
        variant: ProductVariant;
        line: CartLineInput;
    };
    added: {
        cart: ShopifyCart;
        lines: CartLineInput[];
    };
    'group-added': {
        group: string | null;
        lines: CartLineInput[];
    };
    'cart-warning': {
        warnings: readonly CartWarning[];
    };
    'cart-updated': {
        cart: ShopifyCart | null;
        reason: CartUpdateReason;
    };
    'cart-toggled': {
        open: boolean;
    };
    'cart-error': {
        error: unknown;
    };
    checkout: {
        url: string;
        cart: ShopifyCart | null;
    };
    'list-ready': {
        products: Product[];
        collection: Collection | null;
    };
    /** A list's cards were drawn (again): `container` holds them. */
    'list-rendered': {
        container: Element;
    };
    /** The search part's suggestions for `term`. */
    search: SearchResults & {
        term: string;
    };
    'country-changed': {
        country: string;
        language: string | undefined;
    };
    'discount-applied': {
        code: string;
    };
    'discount-invalid': {
        code: string;
    };
    'layout-changed': {
        reason: string;
    };
    error: {
        error: unknown;
        context: string;
        key?: string | null;
    };
    'account-login': Record<string, never>;
    'account-logout': Record<string, never>;
    /** A login that failed: `expired` (it took too long, or came back to another browser) or `error`. */
    'account-error': {
        error: 'expired' | 'error';
    };
    'account-updated': {
        what: 'profile' | 'addresses' | 'subscriptions' | 'orders';
    };
}
/** The events the analytics part reports, which the core buffers from `init()` until the part has loaded. */
export declare const ANALYTICS_EVENTS: readonly ["product-ready", "list-ready", "cart-updated", "cart-toggled", "checkout", "search"];
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];
/** @returns The bubbling event `<prefix>:<name>`, known to `isOwnEvent`. */
export declare function ownEvent<Name extends keyof TetherEvents>(name: Name, detail: TetherEvents[Name]): CustomEvent<TetherEvents[Name]>;
/**
 * @returns True for an event `ownEvent` created as `name`, false for any other, such as one another script dispatched.
 */
export declare function isOwnEvent<Name extends keyof TetherEvents>(event: Event, name: Name): event is CustomEvent<TetherEvents[Name]>;
/** Dispatches the bubbling event `<prefix>:<name>`. */
export declare function emit<Name extends keyof TetherEvents>(name: Name, detail: TetherEvents[Name], target?: EventTarget): void;
