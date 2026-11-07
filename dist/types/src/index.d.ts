/// <reference path="./globals.d.ts" />
import { query, TetherError, withContext } from './client.js';
import { getProduct, getProducts, getRecommendations, clearProductCache, primeProduct } from './loader.js';
import * as plans from './selling-plans.js';
import { resolveProductKey } from './status.js';
import { formatMoney, imageUrl } from './dom.js';
import { VERSION } from './version.js';
import { setCountry } from './page-market.js';
import { addGroup } from './controls/extras.js';
import type { TetherConfig, TetherOptions, MarketsConfig } from './config.js';
import type { ShopifyCart } from './cart/store.js';
import type { ProductScope } from './product.js';
import type { DiagnoseOptions } from './diagnose.js';
import type { TetherEvents } from './markup.js';
export { addGroup, setCountry, VERSION };
export type { TetherOptions as TetherConfig, TetherConfig as ResolvedTetherConfig } from './config.js';
export type { MarketsConfig, CartWarning } from './config.js';
export type { Money } from './shopify-values.js';
export type { Image as ShopifyImage, Metafield as ShopifyMetafield, Product as ShopifyProduct, ProductVariant as ShopifyVariant, SellingPlan as ShopifySellingPlanNode, SellingPlanAdjustmentValue, SellingPlanAllocation as ShopifySellingPlanAllocation, SellingPlanGroup as ShopifySellingPlanGroup, } from './fragments.js';
export type { PlanInGroup as ShopifySellingPlan, PlanAdjustment, ProductWithPlans, VariantWithPlans, } from './selling-plans.js';
export type { CartStatus, CartUpdateReason, CartVariant as ShopifyCartVariant, ShopifyCart, ShopifyCartLine, } from './cart/store.js';
export type { Attributes, LineSpec as LineInput } from './cart/mutations.js';
export type { TetherError, TetherErrorCode, GraphQLError, UserError } from './client.js';
export type { ProductScope } from './product.js';
export type { Purchase } from './product-state.js';
export type { ProductPage, ProductQuery } from './loader.js';
export type { DetectedMarket, Localization, MarketSource } from './markets.js';
export type { SetCountryOptions } from './page-market.js';
export type { DiagnoseOptions, DiagnoseReport } from './diagnose.js';
export type { TetherEvents } from './markup.js';
export type { AccountCustomer } from './account/answers.js';
export type { AccountImage as ImageRef, AccountOrder, AccountOrderLine } from '../server/src/shared/account-orders.js';
export type { AddressFields as CustomerAddressInput } from './account/operations.js';
export type { CustomerAddress, Fulfillment, MailingAddress, OrderDetail, OrderDetailLine, SubscriptionContract, SubscriptionLine, } from './account/page-answers.js';
/** The helpers for selling plans, `Tether.plans`. */
export type SellingPlanHelpers = typeof plans;
/**
 * Mounts every product scope and product list inside `root`. Safe to call repeatedly.
 *
 * @returns The scopes and lists newly mounted.
 */
export declare function mount(root?: Document | Element): number;
/** Call before a page transition removes the page: closes the cart drawer. */
export declare function unmount(): void;
/** @returns The product scope `el` is in. */
export declare function getScope(el: Element | null | undefined): ProductScope | null;
/**
 * Configures Tether (`window.TETHER_CONFIG` with `overrides` over it), applies the visitor's market and loads the
 * cart. A second call without overrides returns the first one's promise.
 *
 * @returns `null` without a domain and token, when Tether stays idle.
 */
export declare function init(overrides?: TetherOptions): Promise<Tether | null>;
/**
 * Listens to the Tether event `<prefix>:<name>`. Only the events Tether dispatched reach the listener: one another
 * script dispatches under the same name is ignored, so the detail is always the one `TetherEvents` gives.
 *
 * @returns Stops listening.
 */
declare function on<Name extends keyof TetherEvents>(name: Name, listener: (detail: TetherEvents[Name], event: CustomEvent<TetherEvents[Name]>) => void): () => void;
declare const publicApi: {
    VERSION: string;
    init: typeof init;
    mount: typeof mount;
    unmount: typeof unmount;
    /** The live config, read-only. */
    readonly config: Readonly<TetherConfig>;
    readonly ready: Promise<Tether | null>;
    query: typeof query;
    withContext: typeof withContext;
    cart: {
        init: () => Promise<ShopifyCart | null>;
        id: typeof import("./cart/store.js").savedCartId;
        readonly status: import("./cart/store.js").CartStatus;
        readonly state: ShopifyCart | null;
        readonly lines: import("./cart/store.js").ShopifyCartLine[];
        readonly count: number;
        readonly loaded: boolean;
        readonly lastError: Error | null;
        readonly warnings: import("./config.js").CartWarning[];
        readonly pendingQty: ReadonlyMap<string, {
            quantity: number;
        }>;
        setCheckoutResolver: typeof import("./cart/checkout.js").setCheckoutResolver;
        forgetSaved(): void;
        render: typeof import("./cart/store.js").render;
        subscribe: typeof import("./cart/store.js").subscribe;
        add(input: string | number | import("./cart/mutations.js").LineSpec | (string | number | import("./cart/mutations.js").LineSpec)[], quantity?: number, options?: Omit<import("./cart/mutations.js").LineSpec, "variantId" | "quantity">): Promise<ShopifyCart>;
        updateLine(lineId: string, patch: number | import("./cart/mutations.js").LinePatch): Promise<ShopifyCart | null>;
        changeQuantity: (lineId: string, delta: number) => Promise<ShopifyCart | null>;
        quantityOf: (line: import("./cart/store.js").ShopifyCartLine) => number;
        removeLine(lineIds: string | string[]): Promise<ShopifyCart | null>;
        clear(): Promise<ShopifyCart | null>;
        setNote(note: string | null | undefined): Promise<ShopifyCart | null>;
        setAttributes(attributes: import("./cart/mutations.js").Attributes): Promise<ShopifyCart | null>;
        setDiscountCodes(codes: string | string[] | ((current: string[]) => string[])): Promise<ShopifyCart | null>;
        applyDiscount(code: string): Promise<ShopifyCart | null>;
        removeDiscount(code: string): Promise<ShopifyCart | null>;
        setBuyerIdentity(buyerIdentity: {
            countryCode?: string;
            email?: string;
            phone?: string;
        }, { create }?: {
            create?: boolean;
        }): Promise<ShopifyCart | null>;
        checkout: typeof import("./cart/checkout.js").checkout;
        drawers: () => HTMLElement[];
        isOpen: typeof import("./cart/drawer.js").isOpen;
        open: typeof import("./cart/drawer.js").openCart;
        close: typeof import("./cart/drawer.js").closeCart;
        toggle: typeof import("./cart/drawer.js").toggleCart;
    };
    getProduct: typeof getProduct;
    getProducts: typeof getProducts;
    getRecommendations: typeof getRecommendations;
    getScope: typeof getScope;
    addGroup: (button: Element) => Promise<ShopifyCart | null>;
    account: {
        login: (args_0?: {
            returnTo?: string;
            locale?: string;
        } | undefined) => Promise<void>;
        customer: () => Promise<import("./account/answers.js").AccountCustomer | null>;
        orders: (args_0?: {
            first?: number;
        } | undefined) => Promise<import("../server/src/shared/account-orders.js").AccountOrder[]>;
        logout: (args_0?: {
            returnTo?: string;
        } | undefined) => Promise<void>;
        render: (root?: ParentNode | undefined) => Promise<void>;
        mountAccount: (root?: ParentNode | undefined) => Promise<void>;
        readonly isLoggedIn: () => Promise<boolean>;
        readonly order: (id: string | number) => Promise<import("./account/page-answers.js").OrderDetail | null>;
        readonly updateProfile: (fields?: {
            firstName?: string;
            lastName?: string;
        }) => Promise<import("./account/page-answers.js").Profile>;
        readonly addresses: () => Promise<import("./account/page-answers.js").CustomerAddress[]>;
        readonly saveAddress: (address: import("./account/operations.js").AddressFields | null, options?: {
            id?: string;
            isDefault?: boolean;
        }) => Promise<import("./account/page-answers.js").AccountAddress>;
        readonly deleteAddress: (id: string) => Promise<string>;
        readonly subscriptions: () => Promise<import("./account/page-answers.js").SubscriptionContract[]>;
        readonly subscriptionAction: (id: string | number, action: import("../server/src/shared/account-routes.js").SubscriptionAction) => Promise<import("./account/page-answers.js").SubscriptionChange>;
        readonly requestReturn: (orderId: string | number, lines: import("./account/operations.js").ReturnLine[]) => Promise<import("./account/page-answers.js").OpenedReturn>;
    };
    primeProduct: typeof primeProduct;
    normalizeProductKey: typeof import("./shopify-values.js").productKey;
    clearProductCache: typeof clearProductCache;
    formatMoney: typeof formatMoney;
    imageUrl: typeof imageUrl;
    plans: typeof plans;
    TetherError: typeof TetherError;
    resolveProductKey: typeof resolveProductKey;
    setCountry: typeof setCountry;
    detectMarket: (markets?: MarketsConfig | null) => Promise<import("./markets.js").DetectedMarket>;
    getLocalization: () => Promise<import("./markets.js").Localization>;
    diagnose: (options?: Omit<DiagnoseOptions, "version">) => Promise<import("./diagnose.js").DiagnoseReport>;
    on: typeof on;
};
/** `window.Tether`, and what `import Tether from '@occluze/tether'` gives. */
export type Tether = typeof publicApi;
/** `Tether`, also carrying `TetherInternals`, which the published type leaves out. */
export declare const api: Tether;
/** @alias `api`, for `import Tether from '@occluze/tether'`. */
export default api;
