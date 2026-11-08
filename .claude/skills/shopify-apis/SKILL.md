---
name: shopify-apis
description: Rules for writing or changing a Storefront API or Customer Account API query or mutation in Tether (src/fragments.ts, src/cart.ts, src/loader.ts, server/src/account/operations.ts). Use before adding a field, a mutation or an API version.
---

# Shopify APIs in Tether

The two reference files are Shopify's own guidance from the Shopify AI Toolkit (MIT, see `LICENSE`), copied unchanged. They were written for Shopify's documentation-search and validation scripts. Those scripts are not copied here, because they send usage data to Shopify and fetch documentation at run time. To validate a new operation against the schema, install Shopify's plugin (`/plugin marketplace add Shopify/shopify-ai-toolkit`) in your own environment, or run `npm run smoke` against a store.

- `references/storefront-graphql.md` covers the Storefront API: products, cart, predictive search, localization.
- `references/customer.md` covers the Customer Account API: orders, addresses, subscriptions, returns.

Tether's own rules on top of Shopify's:

- **Values go in variables, never in the query text.** The one exception is `@inContext`. Its country and language are checked with `toCountry` / `toLanguage` before they are written.
- **The API versions are pinned** in `server/src/shared/api-versions.ts`: `STOREFRONT_API_VERSION` (the default `apiVersion` in `src/config.ts` `DEFAULTS`, and the Worker's account settings), `CUSTOMER_ACCOUNT_API_VERSION` and `ADMIN_API_VERSION` (the sync). Change them there only. A new version must pass `npm run smoke` on both the pinned version and the next one.
- **Every new query or mutation passes `npm run smoke`.** If it touches subscriptions, run it against a dev store that has selling plans.
- **Customer Account operations are fixed documents** in `server/src/account/operations.ts`, and each input is checked there. Server mode has no query passthrough.
