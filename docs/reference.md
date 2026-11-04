# Tether reference

Everything Tether can do, in detail. New here? Start with the [README](../README.md).

- [Products without a CMS item](#products-without-a-cms-item-dynamic-product-page)
- [Loading, error and not-found states](#loading-error-and-not-found-states)
- [Markets and localization](#markets-and-localization)
- [Page transitions (Barba, Swup)](#with-page-transitions-barba-swup-)
- [Attribute reference](#attribute-reference)
- [JavaScript API](#javascript-api) · [Config](#config)
- [Troubleshooting and handover](#troubleshooting-and-handover)
- [Development and releases](#development)

## Products without a CMS item (dynamic product page)

One static Webflow page can show any Shopify product, so products don't need a CMS item:

```html
<!-- page /product, opened as /product?handle=coffee-box -->
<div tether-product="url:handle" tether-page-title="{title} | My shop">
  <div tether-show="loading">Loading…</div>
  <div tether-show="ready">
    <h1 tether-bind="title"></h1>
    …
  </div>
  <div tether-show="not-found">This product doesn't exist (anymore). <a href="/shop">See all products</a></div>
  <div tether-show="error">The shop can't be reached right now. Please try again in a minute.</div>
</div>
```

```js
window.TETHER_CONFIG = { …, productPath: '/product?handle={handle}' };  // every tether-bind="link" points here
```

| Value | Reads |
|---|---|
| `url:handle` | `?handle=` (any parameter works: `url:p` reads `?p=`) |
| `url:path` | the last path segment: `/shop/coffee-box` → `coffee-box` (needs a host that serves one page for every path, e.g. a Cloudflare rewrite; Webflow alone 404s) |

`productPath` templates: `{handle}` and `{id}` (numeric product id), e.g. `/product?handle={handle}`.
`tether-page-title` sets `document.title` (`{title}`, `{vendor}`, `{type}`).

Search engines index dynamic pages poorly (one URL, content loaded by JavaScript). For SEO,
use CMS items, filled by the [sync](../server/README.md).

## Loading, error and not-found states

Every product scope and product list gets `tether-state="loading | ready | error"` (and
`updating` while a rendered product refreshes after a country switch; its content stays visible). On failure
it also gets `tether-error="not-found"` or an error code (`NETWORK`, `HTTP_401`, …).
Inside a scope, `tether-show` follows the state:

| `tether-show` | Visible when |
|---|---|
| `loading` | waiting for Shopify |
| `ready` | the product/list rendered |
| `not-found` | the handle doesn't exist, isn't published to the Headless channel, or the URL has no handle |
| `error` | Shopify couldn't be reached or refused the request (bad token, outage, network) |
| `cart-error` | (outside products) the last cart action failed; hidden again after the next one succeeds |

Give the `error` / `not-found` blocks a class with `display: none` in Webflow, so they stay hidden
if JavaScript doesn't run at all. Tether shows them when needed (as `block`, or the value of
`tether-display`, e.g. `tether-display="flex"`). Add-to-cart buttons in a failed scope are
disabled. Events: `tether:product-not-found`, `tether:error`, `tether:cart-error`.

CSS works too: `[tether-state="loading"] .price { opacity: .3 }`.

## Markets and localization

Prices, currency and product translations follow `country` and `language` (Shopify Markets,
via `@inContext`). Set them statically, or let Tether detect them:

```js
window.TETHER_CONFIG = {
  …,
  country: 'NL', language: 'NL',              // fallback
  markets: {
    detect: true,
    locales: {                                // Webflow Localization: subdirectory or <html lang>
      de: { country: 'DE', language: 'DE', locale: 'de-DE' },
      'fr-be': { country: 'BE', language: 'FR' },
    },
  },
};
```

With `detect: true`, the first match wins for each of country and language:

1. **The visitor's own choice**, saved by `tether-country-select` / `Tether.setCountry()`
   (`remember: false` turns this off). This one applies even without `detect`, so a country
   select keeps its choice across pages; `detect: false` turns detection off completely.
2. **Your server**: `window.TETHER_COUNTRY = 'DE'`, `<meta name="tether-country" content="DE">`,
   or a cookie (`markets.cookie`, default `tether_country`). `TETHER_LANGUAGE` and
   `<meta name="tether-language">` work for language.
3. **Webflow Localization**: the locale subdirectory (`/de/…`) or `<html lang="de-DE">`, looked up in
   `locales`. An unmapped `lang` still gives the language, and the country only when it has a
   region (`de-CH` → CH).
4. The static `country` / `language`.

`detect` also takes a list to limit the sources, e.g. `['server', 'webflow']`.

**Tether never looks up the visitor's IP with a third-party service.** If you want IP-based
country, let your own edge set it. With Cloudflare in front of the site, a few lines in a Worker
or a Transform Rule (no extra service, no personal data leaves your stack):

```js
// Cloudflare Worker in front of Webflow: pass the visitor's country as a cookie
export default {
  async fetch(req) {
    const res = await fetch(req);
    const country = req.cf?.country;               // same as the cf-ipcountry header
    if (!country || country === 'XX') return res;
    const out = new Response(res.body, res);
    out.headers.append('Set-Cookie', `tether_country=${country}; Path=/; Max-Age=86400; SameSite=Lax; Secure`);
    return out;
  },
};
```

**Country selector:**

```html
<select tether-country-select tether-country-label="{name} ({currency})"></select>
<span tether-country-bind="currency"></span>   <!-- name | code | currency | symbol -->
```

It lists the countries from your Shopify Markets (`localization.availableCountries`). Choosing one
calls `Tether.setCountry(code)`, which updates `@inContext`, moves the cart to that market
(`buyerIdentity.countryCode`, so cart prices and checkout currency follow), re-renders every product
and list on the page (selections are kept) and remembers the choice. A saved cart from another
market is moved automatically on the next page load; switching never creates a cart. Responses
that were still on their way from the old market are ignored. Event: `tether:country-changed`.

```js
await Tether.setCountry('BE', { language: 'FR' });
const { availableCountries } = await Tether.getLocalization();
Tether.detectMarket();                         // what detection found, and where
```

Markets have to be set up in Shopify (Settings → Markets) for prices and currencies to differ.

---

## With page transitions (Barba, Swup, …)

Set `autoMount: false`, call `Tether.init()` once, and `Tether.mount(container)` for every new
page container. Keep the cart drawer outside the container. Call `Tether.unmount()` when leaving
a page (it closes the drawer).

```js
import Tether from "@occluze/tether";
import { barbaPreset } from "@occluze/tether/presets/barba";

Tether.init({
  ...window.TETHER_CONFIG,
  ...barbaPreset({
    lenis: () => lenis,                         // resized after async renders
    lockScroll: (drawer) => myScrollLock.lock(drawer),
    unlockScroll: () => myScrollLock.unlock(),
    onValueChange: (el, previous) => {},        // e.g. animate changing numbers
  }),
});

barba.hooks.beforeEnter(({ next }) => Tether.mount(next.container));
barba.hooks.afterLeave(() => Tether.unmount());
// Barba's first load only runs once(): mount there too.
```

With Barba, mount in `beforeEnter` (and in `once()` for the first load) rather than
`afterEnter`, so products load during the transition. With `sync: true` the old and new
containers exist at the same time, so always pass the container, never `document`.

Markup written for an older `wfs-*` prefix keeps working with `prefix: 'wfs'`.

---

## Attribute reference

`tether-` is the default prefix. Every product attribute only applies inside its nearest
`[tether-product]`, so product cards can be nested in a product page.

### Product scope

| Attribute | Value | |
|---|---|---|
| `tether-product` | handle, numeric id, gid, product URL, `url:handle` or `url:path` | Root of a product. Bind to the CMS handle field, or read it from the URL |
| `tether-page-title` | e.g. `{title} \| Shop` | Sets the page title when the product loads |
| `tether-variant` | variant id | Preselect a variant (`?variant=` in the URL also works) |
| `tether-quantity` | number | Start quantity (allows 0, for build-a-box) |
| `tether-bind` | see below | Fill text / image / link |
| `tether-option-list` | option name, e.g. `Size` | Repeater: first child is the button template |
| `select[tether-option]` | option name | Native select for an option |
| `select[tether-variant-select]` | | One select with all variants |
| `tether-option-selected` | option name | Shows the selected value |
| `tether-qty`, `tether-qty-plus`, `tether-qty-minus` | | Quantity input and buttons |
| `tether-line-attribute` | key | Input/checkbox whose value goes on the cart line (engraving, gift note) |
| `tether-line-attributes` | JSON | Fixed line attributes, e.g. `{"_source":"pdp"}` |
| `tether-add-to-cart` | | Button. Optional `tether-adding-text`, `tether-soldout-text`, `tether-subscribe-text`, inner `[tether-add-label]` |
| `tether-show` | condition | Shows/hides, see conditions |

`tether-bind` values: `title`, `description` (HTML), `description-text`, `vendor`, `type`,
`handle`, `published-at`, `price`, `total-price`, `compare-at-price`, `unit-price`, `min-price`,
`max-price`, `discount-percentage`, `discount-amount`, `variant-title`, `variant-id`, `sku`,
`barcode`, `stock`, `quantity`, `featured-image`, `variant-image`, `image:N` (nth image), `images` (repeater), `tags`
(repeater, `exclude="a,b"`), `link`/`url` (href to `productPath`), `metafield:namespace.key`
(add the metafield to `config.metafields`), plus the subscription binds below.

Images accept `max-width`, `max-height`, `crop` for Shopify CDN resizing.

### Subscriptions

Create a selling plan in your subscription app (Shopify Subscriptions, Recharge, …) and add the
product to it. Tether reads the plans via the Storefront API.

| Attribute | |
|---|---|
| `tether-purchase="one-time"` / `"subscription"` | Toggle buttons (or radios). `select[tether-purchase]` also works |
| `tether-plan-list` (value: group name, or empty / `all` for every plan) | Repeater of plans. Inside: `tether-plan-bind="name \| description \| price \| savings \| savings-amount \| adjustment"` |
| `select[tether-plan]` | Select with "One-time purchase" + plans. `tether-one-time-label` sets the label |
| `tether-default-purchase="subscription"` | On the product root. Global: `defaultPurchase` |
| `tether-default-plan="Every month"` | Plan id, name or option value. `?selling_plan=` in the URL also works |

Binds: `price` follows the selected mode. Also `one-time-price`, `subscription-price`,
`subscription-savings` (`10%`), `subscription-savings-amount`, `checkout-charge` (prepaid plans),
`plan-name`, `plan-description`, `plan-group`.

The product root gets class `is-subscription` and `tether-purchase-mode`. Selected buttons get
`is-selected` + `aria-pressed`. Plans the current variant can't use get `is-unavailable`, and
Tether switches to a plan the variant does have.

### Conditions (`tether-show`)

Product: `in-stock`, `out-of-stock`, `backorder`, `low-stock`, `on-sale`, `not-on-sale`,
`has-variants`, `single-variant`, `subscription-available`, `subscription-unavailable`,
`subscription-only`, `one-time-available`, `subscription-selected`, `one-time-selected`,
`has-savings`.

Cart (outside product scopes): `cart-empty`, `cart-filled`, `cart-has-subscription`,
`cart-no-subscription`, `cart-has-discount`, `cart-error`.

State (products and lists): `loading`, `ready`, `error`, `not-found` (see above).

Lists: `list-empty`, `list-filled`.

### Product lists

```html
<div tether-collection="coffee" tether-limit="12" tether-sort="BEST_SELLING">
  <h2 tether-collection-bind="title"></h2>
  <div tether-list>
    <div><!-- card template: any product attributes work here, incl. quick add --></div>
  </div>
  <button tether-load-more>Load more</button>
</div>
```

`tether-products="tag:coffee"` uses Shopify search syntax instead of a collection.
`tether-recommendations="<handle>"` lists related products. `tether-sort` takes the Shopify
sort keys (`BEST_SELLING`, `PRICE`, `CREATED`, `TITLE`, …), with `tether-reverse="true"`.

Using Webflow CMS lists instead? Put `tether-product` on each CMS item, bound to the handle.

### Bundles / build-a-box

```html
<div tether-group="Starter set" tether-line-attributes='{"_bundle":"starter"}'>
  <div tether-product="beans" tether-quantity="0">… qty buttons …</div>
  <div tether-product="filter" tether-quantity="0">…</div>
  <button tether-group-add>Add set</button>
</div>
```

All products with quantity > 0 are added in **one** request, each with its own variant and plan,
and with `_group: Starter set` on every line. (Shopify Bundles products just work as normal
products.)

### Cart

Place these anywhere, typically in a drawer outside the Barba container.

| Attribute | |
|---|---|
| `tether-cart-drawer` | Gets `is-open` (`cartDrawerOpenClass`). Value `manual` = never auto-opened |
| `tether-cart-open` (toggles), `tether-cart-close` | Esc also closes |
| `tether-cart-count`, `tether-cart-subtotal`, `tether-cart-total`, `tether-cart-checkout-charge` | |
| `tether-cart-lines` | Keyed repeater; the first child is the line template |
| `tether-line` | `title`, `variant-title`, `options`, `vendor`, `sku`, `price`, `compare-at-price`, `line-total`, `line-subtotal`, `quantity` (text or input), `image`, `url`, `plan`, `plan-description`, `components`, `attribute:<key>` |
| `tether-line-plus`, `tether-line-minus`, `tether-line-remove` | |
| `select[tether-line-plan]` | Change frequency or switch to one-time, inside the cart |
| `tether-line-show` | `subscription`, `one-time`, `on-sale`, `has-components` |
| `tether-discount-form` + `tether-discount-input` | Gets `is-invalid` on a bad code |
| `tether-cart-discounts` | Repeater with `tether-discount="code"` and `tether-discount-remove` |
| `textarea[tether-cart-note]` | Order note |
| `tether-checkout` | Goes to Shopify checkout (`checkoutTarget: '_blank'` for a new tab) |
| `tether-cart-clear` | |
| `tether-account-link` | Link to Shopify customer accounts (orders + subscription portal) |
| `select[tether-country-select]` | Country selector (Shopify Markets). `tether-country-label="{name} ({currency})"` |
| `tether-country-bind` | `name`, `code`, `currency`, `symbol` of the current country |

---

## JavaScript API

```js
await Tether.ready;
Tether.cart.add({ variantId, quantity: 2, sellingPlanId, attributes: { Engraving: 'R.K.' } });
Tether.cart.add([lineA, lineB]);                  // one request
Tether.cart.updateLine(lineId, 3);
Tether.cart.updateLine(lineId, { sellingPlanId: null });  // to one-time
Tether.cart.removeLine(lineId); Tether.cart.clear();
Tether.cart.setNote('…'); Tether.cart.setAttributes({ source: 'quiz' });
Tether.cart.applyDiscount('WELCOME10'); Tether.cart.setBuyerIdentity({ countryCode: 'DE' });
Tether.cart.open(); Tether.cart.checkout();

const p = await Tether.getProduct('coffee-box');  // batched + cached
const { products, pageInfo } = await Tether.getProducts({ collection: 'coffee', first: 12 });
Tether.getScope(el).selectPlan('Every month');

Tether.query(`query { shop { name } }`);          // anything else in the Storefront API
Tether.plans.planSavings(variant, planId);        // selling plan helpers

Tether.on('cart-updated', ({ cart }) => {});
await Tether.diagnose();                          // what's wrong on this page (see Troubleshooting)
await Tether.setCountry('DE');                    // switch market (see Markets)
```

Events (on `document`, prefixed `tether:`): `ready`, `product-ready`, `variant-changed`,
`product-added`, `added`, `group-added`, `cart-updated`, `cart-toggled`, `checkout`,
`list-ready`, `discount-applied`, `discount-invalid`, `layout-changed`, `product-not-found`,
`product-updated`, `country-changed`, `cart-error`, `error`.

## Config

See [`src/config.js`](../src/config.js) for every option with comments. The ones you'll use most:
`domain`, `token`, `country`, `language`, `locale`, `markets`, `productPath` (supports `{handle}`),
`metafields`, `defaultPurchase`, `checkoutTarget`, `autoMount`, `observe` (auto-mount nodes added
later, e.g. Finsweet load-more), `prefix`, and the hooks `onLayoutChange`, `onCartOpen`,
`onCartClose`, `onLineEnter`, `onLineLeave`, `onValueChange`, `onError`, `cartFocus` (keyboard focus
in the cart drawer, on by default) and `partsUrl` (folder of the optional parts when self-hosting).

**Optional parts.** `Tether.diagnose()` and markets (`markets.detect`, `tether-country-select`,
`Tether.setCountry()`) live in separate files that load on first use: `tether.diagnose.min.js` and
`tether.markets.min.js` next to the main script (jsDelivr serves them from the same folder), or split
chunks in a bundler. `Tether.detectMarket()` and `Tether.getLocalization()` return promises.

**Accessibility.** The cart drawer gets `role="dialog"`, `aria-modal` and a label (`tether-cart-label`
to change it); opening moves focus into it, Tab stays inside, Escape closes it and returns focus.
Cart buttons get `aria-expanded`, unavailable add-to-cart buttons `aria-disabled`.

**Connection loss.** Products and lists that failed to load try again when the browser is back online.

## Troubleshooting and handover

**`Tether.diagnose()`**: run it in the browser console on any page:

```js
await Tether.diagnose()
```

It logs the version, the config (token masked), the API version and how long it's still supported,
whether the token reaches the Storefront API, the selling plans of the products on the page, and
markup problems: product scopes without a handle, `url:handle` pages opened without one, product
attributes outside a product scope, repeaters without a template, unknown `tether-show` values,
metafield binds missing from `config.metafields`. It returns the same report as an object.

**Error reporting (`onError`)**: every failure that reaches the visitor (product or list that
didn't load, add to cart, cart actions, discount codes) goes through `onError(error, context)`.
Errors are `TetherError`s with `code` (`NOT_FOUND`, `NETWORK`, `HTTP_401`, `NOT_CONFIGURED`, …),
`status`, `errors` (GraphQL) and `userErrors` (cart). For Sentry:

```js
window.TETHER_CONFIG = {
  …,
  onError(error, context) {
    if (error.code === 'NOT_FOUND') return;        // optional: deleted products are reported too
    window.Sentry?.captureException(error, { tags: { tether: context, code: error.code } });
  },
};
```

Any other tool works the same (LogRocket, Bugsnag, a `fetch` to your own endpoint). Not-found
products on `url:handle` pages are not reported (that's a mistyped URL); a CMS item pointing at a
deleted Shopify product is.

**Shopify API version.** `apiVersion` is pinned (`2026-07`) on purpose, and never `unstable`
(it changes without notice; Tether warns if you set it). Shopify ships a Storefront API version
every quarter and supports each one for 12 months. `Tether.diagnose()` shows how long your version
is still supported, and warns from 3 months before retirement with the version to move to.
`tether-sync check` refuses a non-dated version for the sync. To upgrade:

1. Read the Storefront API release notes for the versions in between (shopify.dev → API versioning).
2. `TETHER_API_VERSION=$(node scripts/api-version.mjs --next) npm run smoke` (and against your dev
   store with `TETHER_DOMAIN`/`TETHER_TOKEN`) to check every Tether query against the next version.
3. Bump `apiVersion` in `src/config.js` (and `DEFAULT_API_VERSION` in `server/src/shopify.js` for the
   sync), run `npm test`, release. Sites can also set `apiVersion` in `TETHER_CONFIG` themselves.

**Weekly check.** [`.github/workflows/smoke.yml`](../.github/workflows/smoke.yml) runs `npm test` and the
smoke test against the pinned *and* the next quarterly API version, every Monday and on every push
to `main`. When something fails it opens an issue (label `smoke-failure`), or comments on the open
one. In a fork, enable Actions on the fork's Actions tab. Optionally add the repository secrets
`TETHER_DOMAIN` and `TETHER_TOKEN` (a public Storefront token of your test store) to test your own
store, selling plans included; without them it uses Shopify's public demo store. A run takes
1–2 minutes, and Actions minutes are free on public repositories.

Run `npm test` and `npm run smoke` before every release; the smoke test needs no setup.

---

## Development

```bash
npm install
npm run build     # dist/tether.js, tether.min.js, tether.esm.js
npm run dev       # watch
npm test          # unit tests: client (jsdom, mocked Storefront API) + server/ sync (mocked APIs)
npm run smoke     # live test against a real store (default: Shopify's public demo store)
TETHER_DOMAIN=x.myshopify.com TETHER_TOKEN=... npm run smoke   # your dev store, incl. selling plans
TETHER_API_VERSION=2026-10 npm run smoke                        # try a newer Shopify API version
node scripts/api-version.mjs --next                             # the next quarterly version
```

**Releases:** write the `## X.Y.Z` section in `CHANGELOG.md`, then

```bash
npm run release -- 0.4.1 --push
```

It bumps the version everywhere (packages, `VERSION`, the sync, README pins, `server/TETHER_VERSION`
for a new minor), builds, runs the tests and the live smoke test, commits, tags and pushes. The
`release` workflow then publishes to npm with provenance (npm trusted publishing, no token in the
repo) and creates the GitHub Release with the files. jsDelivr serves the tag immediately, and
deployed sync Workers pick it up through their Update Tether action within their range.

## Subscriptions: what Shopify handles, not Tether

Tether gets the subscription into the cart with the right plan. After that it's all Shopify:
checkout, the recurring charge, the contract, and the customer portal (skip, pause, swap,
cancel) in the subscription app / Shopify customer accounts. Test those flows in a dev store
with payments in test mode.
