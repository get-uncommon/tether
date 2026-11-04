# Changelog

## 0.3.2 (2026-11-04)

- Worker: `POST /reconcile?since=all` (with `SYNC_SECRET`) runs a full first import without
  the CLI; if it doesn't fit in one run, the cron continues it.
- Fix: a half-done reconcile window that started from an explicit `since` is now resumed by the
  next run instead of being dropped.

## 0.3.1 (2026-11-04)

- Deploy to Cloudflare: the form starts empty (no example values), with clearer descriptions
  of what's required.
- Example values (`your-…`, `choose-…`, `…`) and a `SYNC_SECRET` shorter than 24 characters
  count as not set, so a left-over example can never unlock `/reconcile` or the API tests on
  `/check`. `check` names each such value.
- CI: actions/checkout and actions/setup-node v5 (Node 24).

## 0.3.0 (2026-11-04)

**Markets and localization**
- `markets: { detect: true, locales }`: country/language from the visitor's saved choice, your
  server (`window.TETHER_COUNTRY`, `<meta name="tether-country">`, a cookie such as one set from
  Cloudflare's `cf-ipcountry`) or Webflow Localization (locale subdirectory or `<html lang>`).
  No IP lookups from the browser.
- `select[tether-country-select]` (from `localization.availableCountries`) and `tether-country-bind`.
- `Tether.setCountry(code, { language })`: updates `@inContext`, the cart's
  `buyerIdentity.countryCode`, and re-renders products (keeping the selection) and lists.
  A saved cart from another market is moved on load. Events `country-changed`, `product-updated`.
- `Tether.getLocalization()`, `Tether.detectMarket()`; diagnose() shows the detected market.
- Switching ignores responses still on their way from the old market, keeps rendered products
  visible (`tether-state="updating"`), never creates a cart, and a saved choice applies without
  `detect`. Detached roots from page transitions are released.

**Shopify API upgrade safety**
- `scripts/api-version.mjs [--next]`; diagnose() names the version to upgrade to; a warning for
  `apiVersion: 'unstable'`.
- `.github/workflows/smoke.yml`: weekly and on push, tests + smoke on the pinned and the next
  API version; opens/updates an issue on failure.
- The smoke test covers the localization query and `setCountry`.

**Server sync**
- Deploy to Cloudflare button: `server/wrangler.jsonc` (KV binding, cron), secrets prompted from
  `.dev.vars.example`, descriptions in `package.json`.
- The config file now ships as a working default for a standard Products collection, with
  `SHOPIFY_DOMAIN` / `WEBFLOW_COLLECTION_ID` from the environment, `FIELD_MAP` / `WEBFLOW_OWNED`
  overrides, and `webflow.skipMissingFields` (on by default).
- `tether-sync check` is a guided first-run: what's missing, how to fix it, API and mapping tests,
  a sample item. Also at `GET /check` on the Worker (API tests only with `SYNC_SECRET`).
- Secrets set to `none` count as unset.
- Reliability (from a review of 0.2.0):
  - Product pages fit Shopify's 1,000-point query cost limit (25 variants, 10 images per
    product, ~19 products per page) and shrink on `MAX_COST_EXCEEDED`.
  - Reconcile budgets products, pages and subrequests (Worker: `MAX_SUBREQUESTS`, default 45),
    saves its exact position (page + offset) and never stalls on bulk edits; the window overlaps by
    `overlapMinutes`; a Shopify error saves progress instead of throwing.
  - Hashes are stored only after a successful publish; a failed publish is retried.
  - Duplicate items from concurrent runs are prevented (Webflow's unique slug: the loser adopts
    the winner's item); a created item's id is stored before publishing.
  - Webhook runs fail fast on long rate-limit waits and queue the product for reconcile.
  - The client-credentials token and the Webflow item index are cached in the store.
  - A draft product whose item was deleted in Webflow is no longer recreated; prune with
    `onDelete: 'unpublish'` no longer repeats.
  - `SYNC_SECRET=none` no longer opens `/reconcile`; `/check` without the secret hides values.
  - The Node state file batches writes, merges with other processes and recovers from a failed write.
- Fix: `server/src/worker.js` was excluded by `.gitignore` in 0.2.0.

## 0.2.0 (2026-11-04)

**Products without a Webflow CMS item**
- `tether-product="url:handle"` (any query parameter, e.g. `url:p`) and `url:path` (last path
  segment): one static page renders any Shopify product.
- `productPath` templates accept `{handle}` and `{id}`, e.g. `'/product?handle={handle}'`.
- `tether-page-title="{title} | Shop"` sets the document title.

**Robustness**
- State blocks: `tether-show="loading | ready | error | not-found"` in products and lists,
  `tether-show="cart-error"` for the cart. Blocks hidden by a Webflow class are shown too.
- Failed scopes get `tether-error` (`not-found` or an error code) and disabled add-to-cart buttons.
- Errors carry a `code` (`NOT_FOUND`, `NETWORK`, `HTTP_401`, …). New events `product-not-found`
  and `cart-error`; product and list failures also emit `error`.
- A failed cart load no longer forgets the cart when Shopify is only unreachable.
- `Tether.diagnose()`: config, API version support window, token reachability, selling plans
  and markup problems on the page.
- Documented `onError` for Sentry-style reporting and the Shopify API upgrade process.
  `npm run smoke` checks diagnose and not-found, and takes `TETHER_API_VERSION`.

**Server-side sync (new, `server/`)**
- Shopify → Webflow CMS sync for a Cloudflare Worker or a Node CLI: HMAC-verified product
  webhooks, idempotent `reconcile` cron with a cursor and a per-run budget, `import` with `--prune`,
  per-project field mapping with Webflow-owned fields, Webflow throttling, `check` command.
  See `server/README.md`.

## 0.1.3 (2026-11-04)

- `tether-bind="image:N"` binds the nth product image (e.g. a lifestyle shot), falling back to the featured image.

## 0.1.2 (2026-11-04)

- `tether-plan-list="true"` / `"all"` / `"*"` now list every plan, like an empty value (Webflow often can't save empty attribute values).

## 0.1.1 (2026-11-04)

- Fix: attributes on the product root element itself (e.g. a card link with `tether-bind="link"`) were ignored.

## 0.1.0 (2026-11-04)

First release.

- Products, variants, options, swatches, metafields, recommendations
- Product lists from collections or search, with load more
- Cart: add (single or many lines), update, remove, clear, note, attributes,
  discount codes, buyer identity, checkout (same or new tab), drawer
- Subscriptions via Shopify selling plans: one-time/subscribe toggle, plan list,
  subscription price and savings, change plan or switch to one-time in the cart
- Bundles / build-a-box with `tether-group`
- Markets via `@inContext(country, language)`
- Configurable attribute prefix (`prefix: 'wfs'` for older markup)
- Hooks for page transitions, scroll locks and animations; generic Barba/Lenis/GSAP preset
- Tolerates tokens without the inventory permission
