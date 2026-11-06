---
name: shopify-apis
description: Rules for writing or changing a Storefront API or Customer Account API query or mutation in Tether (src/fragments.js, src/cart.js, src/loader.js, src/shared/account-ops.js). Use before adding a field, a mutation or an API version.
---

# Shopify APIs in Tether

The two reference files are Shopify's own guidance from the Shopify AI Toolkit (MIT, see `LICENSE`), copied unchanged. They were written for Shopify's documentation-search and validation scripts. Those scripts are not copied here, because they send usage data to Shopify and fetch documentation at run time. To validate a new operation against the schema, install Shopify's plugin (`/plugin marketplace add Shopify/shopify-ai-toolkit`) in your own environment, or run `npm run smoke` against a store.

- `references/storefront-graphql.md` covers the Storefront API: products, cart, predictive search, localization.
- `references/customer.md` covers the Customer Account API: orders, addresses, subscriptions, returns.

Tether's own rules on top of Shopify's:

- **Values go in variables, never in the query text.** The one exception is `@inContext`. Its country and language are checked with `toCountry` / `toLanguage` before they are written.
- **The API version is pinned** in `DEFAULTS.apiVersion` and `server/src/shopify.js`. A new version must pass `npm run smoke` on both the pinned version and the next one.
- **Every new query or mutation passes `npm run smoke`.** If it touches subscriptions, run it against a dev store that has selling plans.
- **Customer Account operations are fixed documents** in `src/shared/account-ops.js`, and each input is checked there. Server mode has no query passthrough.
