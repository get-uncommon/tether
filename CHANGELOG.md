# Changelog

## 0.6.3 (2026-11-05)

- Customer accounts, server mode on a deployed Worker: login failed with "account error" because
  the store domain's bot protection answers 403 to Workers for its `.well-known` files. The Worker
  now finds the shop id through the Storefront API and uses Shopify's account addresses directly
  (needs `STOREFRONT_TOKEN`, which server mode already asks for).

## 0.6.2 (2026-11-05)

From testers building an Astro store from the starter:

**Fixes**
- Cart: quick +/− clicks no longer step the count and totals through every reply from Shopify
  (+ + + − from 1 showed 2, 3, 4, 3). Only the latest quantity is sent; a click that undoes the
  last one sends nothing.
- A wrong token (or an Admin token, `shpat_…`) now says so, naming the store: Shopify's 401 has
  no message, so the error (and `astro build`'s output) was empty.
- `hydrate(products, { card: true })` keeps two images per product (a hover image,
  `tether-bind="image:2"`), `images: n` for more. Cards with a second image showed the first one
  until the background refresh.
- `diagnose()`: documented values (`tether-show="search-empty"`, `logged-in`, `logged-out`) are no
  longer called unknown. It now finds typos, with a suggestion: `tether-bind="pric"`, attributes like
  `tether-bnd` or `tether-add-to-card`, and an option list for an option the product doesn't have.
  Clearer messages, with no empty or `undefined` parts.
- Types: `initialState(product)` is non-null for a product (strict `astro check` passes with the
  docs' examples). `show` has `plenty-in-stock` and `has-savings`. `getProduct()` and
  `getProducts({ query })` take `null`/`undefined`. A typo in `createStorefront()` options is now
  a type error.
- Astro integration: in dev, a change to `src/shop.config.js` restarts the dev server, so the
  browser gets the new config too (`watch` for other files). `.env` files follow `--mode`, and the
  store variables are declared through `astro:env`.

**New**
- `account.server` can be a path on your own site (`'/_tether/account'`).
- Accounts: `tether-show="orders-loading"` / `"orders-empty"`, `tether-order-bind="image"`, and
  `tether-order-lines` with `tether-order-line="title|variant-title|quantity|image"`.
- `tether-products="url:q"`: search results for the page's `?q=` on a static site.
- `tether-max-width` / `data-max-width` (and `-max-height`, `-crop`): valid HTML for image sizes.

**Starter and docs**
- README: the three ways to install side by side (script tag via jsDelivr, npm, with the Worker),
  with when to pick each.
- The Astro starter has `site`, canonical links, a favicon, a 404 page, a static search page,
  `tsconfig.json`, and no longer ignores `package-lock.json`. The first cards and the first product
  image load eagerly (`fetchpriority="high"`), the rest lazily.
- Astro guide: `astro:assets` `<Image>` makes images download twice with Tether (use `<img>`),
  fonts with `<ClientRouter />`, search pages need SSR (or `url:q`), a null check for unknown
  collections, `prerender` with SSR, and `revalidate: false` for SSR pages.

## 0.6.1 (2026-11-04)

**Customer accounts, server mode: fixes from an independent security review** (nothing critical
was found; every finding is fixed and has a test):
- Login CSRF: the pending login is now sealed in an HttpOnly cookie in the browser that started
  it, so a login link from someone else can't log a visitor into the wrong account. As a result,
  nothing is written to KV before a real login (no quota abuse by anonymous requests).
- `/login` no longer takes a cart; carts are only linked through the protected `POST /cart`.
- Logout can't fail open: the session is ended and the cookie cleared first, even when Shopify is
  down. The id token for Shopify's logout goes through a one-time HttpOnly cookie, never the page.
- Sessions have an absolute lifetime (`ACCOUNT_SESSION_DAYS`), end when Shopify ends them, and
  survive two requests refreshing at once.
- A separate encryption key per purpose, bound to its KV key; optional `ACCOUNT_SECRET`.
- Order links must be https; stricter cart ids; no setup details in public errors.

**Sync:** new deploys follow every release (`TETHER_VERSION` is `latest`).

**Docs:** the comparison covers 0.6 (accounts, search, analytics, frameworks).

## 0.6.0 (2026-11-04)

Found by 10 agents building stores from the docs alone (Astro static and SSR, plain HTML, Vite,
SvelteKit, Next.js, Eleventy, subscriptions, multi-market, an accessible React cart) and 10 more
shopping in them (phone, keyboard only, screen reader, German, French, US, bargain hunter, …).

**New: optional parts** (each loads only on pages that use it; the main script stays 20 KB)
- **Search as you type** (`tether-search`, 2 KB): Shopify's predictive search with products,
  collections and suggested searches; keyboard and screen-reader friendly.
- **Customer accounts** (4 KB): login on Shopify's page, the customer's name and orders, a checkout
  that knows them. **Server mode** (recommended): your sync Worker does the login (OAuth with PKCE,
  the id token's signature checked), keeps the tokens encrypted in KV and gives the browser only an
  HttpOnly session cookie, so no Shopify token ever reaches the browser. Browser mode for quick
  starts. Both tested on a real store. [Guide](docs/accounts.md).
- **Analytics** (`analytics`, 3 KB): GA4 / Tag Manager ecommerce events in `dataLayer`, Shopify's
  own analytics (experimental, through Shopify's scripts), or `onEvent` for any tool. [Guide](docs/analytics.md).
- **Structured data:** `shop.jsonLd(product)` for Google's product results.
- **Other markets on static sites:** `html.tether-market-pending` until the visitor's prices are in.
- **Real-browser tests** (36, in Chromium, WebKit, Firefox and a phone, on every push): the
  starter, a plain HTML page with the `<script>` build and its optional parts, GA4 events, the
  market marker, and Shopify analytics with Shopify's real scripts (their sends intercepted).

**Fixes**
- **Stale prices:** Shopify caches the answer to an identical query text, prices included, for
  hours after a change. Tether's queries now carry a one-minute time marker (`maxAge`, default 60
  seconds), so the server module, builds and pages get current prices. (The cart always had them,
  so a page could show one price and checkout charge another.)
- Two quick clicks on cart +/− counted once; they now add up, show at once, and the line gets
  `is-busy` until Shopify answers. `Tether.cart.changeQuantity(lineId, ±1)` does the same for your
  own buttons; `Tether.cart.quantityOf(line)` shows the pending quantity.
- Clicking an option value that's unavailable with the current choices threw the other choices
  away. It now picks the closest variant that has the value; a value no variant has is ignored.
- View Transitions into a page built for another market (`/de/`) kept the old market. New:
  `<meta name="tether-page-country|language|locale">` makes a page that market, also back again.
- With the Astro integration, a visitor's saved money format lost to the config on every page.
- The country select now takes the language (or none) from the `markets.locales` entry for that
  country, instead of keeping the previous one.
- `Tether.cart.open()` did nothing without a `tether-cart-drawer` (React/Svelte/Vue carts); it now
  sets the open state for `subscribe`.
- `tether-show="list-empty"`, `list-filled` and `tether-load-more` ignored the `hidden` attribute.
- A closed cart drawer is `inert`: its buttons are no longer in the Tab order.
- `applyDiscount()` with a code Shopify doesn't accept rejects (`INVALID_DISCOUNT`) and doesn't keep
  the code; the form also sets `aria-invalid`. Repeated warnings are shown once.
- Recommendations for a missing product are no longer reported to `onError`.

**New**
- Cart warnings per line: `tether-line="warning"`, `is-warning`, `tether-line-show="warning"`, and
  `warningText(w)` to translate Shopify's messages. Cart lines carry `merchandise.quantityAvailable`.
- Shareable variant links: `variantUrl: true` (or `tether-variant-url`) keeps `?variant=` in the URL.
- Tabs stay in sync: a cart change or market switch in one tab updates the others. The cart count
  shows its last known value at once on the next page, instead of 0.
- `tether-show="plenty-in-stock"`, `lowStock` (default 5), `tether-plan-bind="option"`,
  `tether-recommendations="url:handle"` (or empty inside a product).
- Savings in the locale's format (`30 %` in German and French); `shop.formatPercent()`.
- `checkout-charge` counts the quantity.
- Server: `hydrate(products, { card: true })` for lists (about 40% smaller); `initialState()` gains
  `has-savings`, `plenty-in-stock`, `plans`, `savings` and a plain `unavailable` map; `lowStock`.
- `diagnose()` shows the market in use and warns about product options the page offers no way to choose.
- Types: `seo`, `setCountry` options (`locale`, `language: null`), the new config options.
- Docs: [other frameworks](docs/frameworks.md) (Next.js, SvelteKit, Vite, Eleventy); many
  attributes and classes that were only in the code are now in the reference.

The main script is 20.1 KB gzipped (18.5 KB in 0.5): the fixes above. Bundles, tab sync and
variant links moved to the optional `extras` part (1 KB).

## 0.5.0 (2026-11-04)

**Astro** ([guide](docs/astro.md), [starter](examples/astro)): Shopify product pages built at build
time (or per request with SSR), with live prices, stock, variants, subscriptions and the cart.
- `@occluze/tether/astro`: an integration that adds Tether to every page, configured from `.env`
  (`PUBLIC_SHOPIFY_DOMAIN`, `PUBLIC_SHOPIFY_STOREFRONT_TOKEN`).
- `@occluze/tether/server`: `createStorefront()` for build-time and server data: `getProduct`,
  `getProducts`, `allProducts`, `getCollection`, `allCollections`, `getRecommendations`,
  `formatMoney`, `productUrl`, `imageUrl`, `query`. Same product shape as the browser.
- Hydration: `shop.hydrate(products)` puts the data in the page; the browser renders it without a
  request and refreshes prices and stock once in the background, batched for the whole page
  (`revalidate: false` to skip). Server-rendered images and products loaded earlier in the visit are kept.
- View Transitions (`<ClientRouter />`) work by themselves: each page is mounted, the cart closes
  on navigation (`astro: false` to turn off).
- `shop.initialState(product)`: what Tether shows first (variant, price, purchase mode, every
  `tether-show` condition, unavailable options), so server-rendered pages don't change when the
  script takes over. Same rules as the browser, covered by a test that compares the two.
- `Tether.cart.subscribe(fn)` for React, Svelte and Vue islands, with `loaded` (saved cart known)
  and `warnings`. `Tether.cart.loaded`, `Tether.imageUrl()`.
- `getRecommendations()` also takes a handle (server and browser), so it runs next to `getProduct()`.

**Sync: rebuild on change.** `DEPLOY_HOOK_URL` starts a build of a statically built site
(Cloudflare Pages, Netlify, Vercel) when product content changes; stock changes don't. At most one
build per `DEPLOY_HOOK_MIN_SECONDS` (60). Works with or without Webflow.

**Fixes** (found by first-time users building with the docs only):
- `tether-show` elements hidden before the script ran (a class, `style="display:none"`, `hidden`)
  are now shown when their condition applies, for every condition, not only error/not-found.
- Cart line links (`tether-line="url"`) open the variant that's in the cart.
- `tether-checkout` gets `is-disabled` / `aria-disabled` while the cart is empty.
- Cart warnings: asking for more than is in stock used to change the quantity silently. Shopify's
  message now shows in `tether-show="cart-warning"` / `[tether-cart-warning]`, with a
  `tether:cart-warning` event (API 2024-07 and later; older versions just skip it).
- Cart line links also keep the subscription plan (`selling_plan=`).
- `cart.subscribe` and `tether:cart-updated` now also fire when the saved cart has loaded.
- Discount codes: the form no longer becomes a page navigation with Astro's router; an invalid
  code gets `is-invalid` and is removed from the cart (it used to stay and repeat its warning).
- Another language: when Shopify translates option names (Size → Größe), `tether-option-list`,
  `tether-option` and `tether-option-selected` keep matching (by position).
- `Tether.query()` / `shop.query()` add the market to anonymous and shorthand queries too.
- `diagnose()` knows `tether-show="cart-warning"`.

**Markets:**
- `setCountry('DE', { locale: 'de-DE' })`, or a `locale` in a `markets.locales` entry for that
  country: the money format follows the country, and is remembered with it.
- `tether-countries="NL,DE"` limits a country select to your markets, in your order.
- With the Astro integration, `window.TETHER_CONFIG` in the layout no longer starts a second,
  unconfigured Tether.

## 0.4.0 (2026-11-04)

**Smaller:** the script every visitor loads went from 62.9 KB to 50.8 KB (20.7 → 17.1 KB gzipped, 15.4 KB brotli), while gaining the fixes below.
- Diagnose and markets are optional parts, loaded on first use (`tether.diagnose.min.js`,
  `tether.markets.min.js`, next to the main script; split chunks for bundlers). Self-hosting: copy
  them too, or set `partsUrl`. `Tether.detectMarket()` and `Tether.getLocalization()` now return
  promises.
- Built for ES2020 browsers (no helpers for `?.` and `??`), GraphQL minified at build time.

**TypeScript types** for the whole API, config, events and the Barba preset.

**Tested on a real Webflow site** (product pages, subscriptions, cart, Barba transitions), fixing:
- The cart drawer is now keyboard and screen-reader friendly: dialog semantics, focus moves in and
  back, Tab stays inside, `aria-expanded` on cart buttons (`cartFocus: false` to turn off).
- Add-to-cart links (not only buttons) get `aria-disabled` when unavailable.
- Products and lists that failed on a network error load again when the browser is back online.

**Releases in one step:** `npm run release -- X.Y.Z --push`; a workflow publishes to npm with
provenance (trusted publishing) and creates the GitHub Release.

The npm package shows the author link (occluze.com).

## 0.3.6 (2026-11-04)

- Fix: updates of deployed sync copies could be rejected by GitHub, because an Action's token may
  not change workflow files. The updater no longer touches `.github/`; the workflow file stays as
  it was deployed, and all update logic lives in `scripts/update-tether.mjs`, which updates itself.
  (Reverts the 0.3.5 workflow step.)
- On npm: `npm install @occluze/tether`.

## 0.3.5 (2026-11-04)

- Sync updates can't silently stall: after committing an update, the Update Tether action waits
  until Cloudflare has started the build, pushes again once if it hasn't, and fails visibly
  otherwise (GitHub emails you).
- New [comparison page](docs/comparison.md): Tether vs Smootify vs Storesynk (formerly Shopyflow),
  with sources. Fixed the competitor's name (Shopyflow, not "Shopiflow") in the description.

## 0.3.4 (2026-11-04)

- Shorter READMEs with what everyone needs; the full reference moved to `docs/reference.md`, the
  sync's technical details to `server/docs/advanced.md`.
- The README recommends `@0.3` on jsDelivr (every 0.3.x fix), with `@v0.3.4` to pin and `@latest`.
- Sync `/check`: the "update available" note reads versions from jsDelivr (GitHub's API rate-limits
  unauthenticated calls from Cloudflare). The updater also updates `docs/`.

## 0.3.3 (2026-11-04)

Tested live: Deploy to Cloudflare → first import into a Webflow collection → webhooks registered by
the Worker → create, rename, draft, re-activate and delete a Shopify product, each reflected in
Webflow within seconds.

- The Deploy form asks only for what a deploy needs: store domain, collection id, Webflow token,
  Shopify client id + secret, `SYNC_SECRET`. Optional settings are documented as secrets to add
  later (`FIELD_MAP`, `WEBFLOW_OWNED`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, `MAX_SUBREQUESTS`).
- No manual webhook setup: the Worker registers the product webhooks through the app on its first
  `POST /reconcile` (signed with the client secret). `/check` reports them; the CLI has
  `tether-sync webhooks <url>`. Webhooks signed with either the client secret or
  `SHOPIFY_WEBHOOK_SECRET` are accepted.
- `check` folds fields the collection doesn't have into one line instead of a warning per field.
- Deployed copies update themselves: `TETHER_VERSION` (`0.3` patches only, `0.3.3` pinned,
  `latest`) and an **Update Tether** GitHub Action in the copy (weekly, or Run workflow) that
  takes the newest matching release, tests it, commits it and lets Cloudflare redeploy. Mapping,
  Cloudflare ids and secrets are kept. The Action keeps its schedule alive, `/health` shows the
  running version, and `/check` warns when an update in the range hasn't been installed.

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
