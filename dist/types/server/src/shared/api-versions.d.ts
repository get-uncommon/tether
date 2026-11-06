/**
 * The Shopify API versions Tether is built and smoke-tested against, for the browser script and the Worker alike. The
 * three APIs are versioned separately, so each has its own constant even while they hold the same quarter. A new
 * version must pass `npm run smoke` on both the pinned version and the next one.
 */
/** A dated, quarterly version such as `2026-07`. */
export type ApiVersion = `${number}-${'01' | '04' | '07' | '10'}`;
/** The Storefront API: products, carts, cart buyer identity. */
export declare const STOREFRONT_API_VERSION: ApiVersion;
/** The Customer Account API: the logged-in customer's orders, addresses and subscriptions. */
export declare const CUSTOMER_ACCOUNT_API_VERSION: ApiVersion;
/** The Admin API the sync reads products with. */
export declare const ADMIN_API_VERSION: ApiVersion;
