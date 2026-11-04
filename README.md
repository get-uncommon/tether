# Tether

Shopify ↔ Webflow (or any HTML) through the Shopify **Storefront API**: products, variants,
collections, cart, checkout and **subscriptions (selling plans)**. All driven by HTML attributes,
with no Shopify theme involved.

**An open-source alternative to Smootify, Shopiflow and similar paid Webflow–Shopify apps.**
No subscription, no per-site fee: use it straight from jsDelivr, or host the single file
yourself (Cloudflare, Webflow assets, your own bundle).

MIT licensed. Status: 0.1, tested against a Shopify dev store with Shopify Subscriptions
(product page, plans, cart, subscription checkout) and with Barba page transitions.

- One script tag, no dependencies, ~45 KB minified
- Works with Webflow CMS: bind `tether-product` to the CMS field that holds the Shopify handle
- Subscriptions via Shopify selling plans (Shopify Subscriptions, Recharge, Skio, Loop, Appstle, …)
- Bundles / build-a-box: add multiple products in one request
- Barba/Swup-friendly: `Tether.mount(container)` per page, cart drawer lives outside the container
- Preset for page-transition sites: Barba/Swup + Lenis + GSAP, scroll lock and cart line animations

Prices, stock and variants always come live from Shopify. Webflow only holds content and layout.
(A server-side sync that writes Shopify data into the Webflow CMS is on the roadmap.)

---

## Install

**Script tag (Webflow, any HTML):** pin a version from jsDelivr:

```html
<script src="https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@v0.1.0/dist/tether.min.js" defer></script>
```

**Bundled (Vite, esbuild, Webpack, …):** copy `dist/tether.esm.js` into your project, or install from GitHub:

```bash
npm install github:ravi-klaassens/tether#v0.1.0
```

```js
import Tether from "@occluze/tether";
```

To host it yourself (Cloudflare, Webflow assets, your own CDN), upload `dist/tether.min.js` from a release.
It's one static file with no backend.

## Shopify setup (5 minutes)

1. **Headless** channel (free app by Shopify) → Create storefront → Storefront API → copy the
   **public access token**. Never use the private token or an Admin API token in the browser.
2. Same page → Storefront API permissions: enable product listings, **product inventory**,
   product tags, checkouts (read + write) and **selling plans**. Add metaobjects/bundles if you use them.
3. Products → select all → *Include in sales channels* → **Headless**.
4. Subscriptions (optional): install a subscription app (Shopify Subscriptions, Recharge, Skio,
   Loop, Appstle, …), create a plan and add products. Tether picks it up automatically.
5. Customer accounts (for the subscription portal): Settings → Customer accounts → new accounts.

Testing in a dev store: checkout is behind the store password (Online Store → Preferences),
and payments need a test payment provider or Shopify Payments in test mode.

## Quick start

```html
<!-- Webflow: Site settings → Custom code → Head -->
<script>
  window.TETHER_CONFIG = {
    domain: 'your-store.myshopify.com',
    token: 'PUBLIC_STOREFRONT_TOKEN',
    country: 'NL',
    locale: 'nl-NL',
    productPath: '/product',      // your Webflow product template path
  };
</script>
<script src="https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@v0.1.0/dist/tether.min.js" defer></script>
```

**Try it locally:** `npm install && npm run build`, then serve the folder and open
`examples/index.html`. It runs against Shopify's public demo store by default; add
`?domain=x.myshopify.com&token=...` to use yours.

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
| `tether-product` | handle, numeric id, gid or product URL | Root of a product. Bind to the CMS handle field |
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
`barcode`, `stock`, `quantity`, `featured-image`, `variant-image`, `images` (repeater), `tags`
(repeater, `exclude="a,b"`), `link`/`url` (href to `productPath`), `metafield:namespace.key`
(add the metafield to `config.metafields`), plus the subscription binds below.

Images accept `max-width`, `max-height`, `crop` for Shopify CDN resizing.

### Subscriptions

Create a selling plan in your subscription app (Shopify Subscriptions, Recharge, …) and add the
product to it. Tether reads the plans via the Storefront API.

| Attribute | |
|---|---|
| `tether-purchase="one-time"` / `"subscription"` | Toggle buttons (or radios). `select[tether-purchase]` also works |
| `tether-plan-list` (optional value: group name) | Repeater of plans. Inside: `tether-plan-bind="name \| description \| price \| savings \| savings-amount \| adjustment"` |
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
`cart-no-subscription`, `cart-has-discount`.

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
```

Events (on `document`, prefixed `tether:`): `ready`, `product-ready`, `variant-changed`,
`product-added`, `added`, `group-added`, `cart-updated`, `cart-toggled`, `checkout`,
`list-ready`, `discount-applied`, `discount-invalid`, `layout-changed`, `error`.

## Config

See [`src/config.js`](src/config.js) for every option with comments. The ones you'll use most:
`domain`, `token`, `country`, `language`, `locale`, `productPath` (supports `{handle}`),
`metafields`, `defaultPurchase`, `checkoutTarget`, `autoMount`, `observe` (auto-mount nodes added
later, e.g. Finsweet load-more), `prefix`, and the hooks `onLayoutChange`, `onCartOpen`,
`onCartClose`, `onLineEnter`, `onLineLeave`, `onValueChange`, `onError`.

---

## Development

```bash
npm install
npm run build     # dist/tether.js, tether.min.js, tether.esm.js
npm run dev       # watch
npm test          # unit tests (jsdom, mocked Storefront API)
npm run smoke     # live test against a real store (default: Shopify's public demo store)
TETHER_DOMAIN=x.myshopify.com TETHER_TOKEN=... npm run smoke   # your dev store, incl. selling plans
```

Releases: bump `package.json`, update `CHANGELOG.md`, `npm run build`, commit `dist/`, tag `vX.Y.Z`.
jsDelivr serves the tag immediately.

## Subscriptions: what Shopify handles, not Tether

Tether gets the subscription into the cart with the right plan. After that it's all Shopify:
checkout, the recurring charge, the contract, and the customer portal (skip, pause, swap,
cancel) in the subscription app / Shopify customer accounts. Test those flows in a dev store
with payments in test mode.

## License

MIT © Ravi Klaassens
