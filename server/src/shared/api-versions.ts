/**
 * The Shopify API versions Tether is built and smoke-tested against, for the browser script and the Worker alike. The
 * three APIs are versioned separately, so each has its own constant even while they hold the same quarter. A new
 * version must pass `npm run smoke` on both the pinned version and the next one.
 */

/** The Storefront API: products, carts, cart buyer identity. */
export const STOREFRONT_API_VERSION = '2026-07';

/** The Customer Account API: the logged-in customer's orders, addresses and subscriptions. */
export const CUSTOMER_ACCOUNT_API_VERSION = '2026-07';

/** The Admin API the sync reads products with. */
export const ADMIN_API_VERSION = '2026-07';
