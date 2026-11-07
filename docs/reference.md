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

| Value        | Reads                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url:handle` | `?handle=` (any parameter works: `url:p` reads `?p=`)                                                                                                      |
| `url:path`   | the last path segment: `/shop/coffee-box` → `coffee-box` (needs a host that serves one page for every path, e.g. a Cloudflare rewrite; Webflow alone 404s) |

`productPath` templates: `{handle}` and `{id}` (numeric product id), e.g. `/product?handle={handle}`.
`tether-page-title` sets `document.title` (`{title}`, `{vendor}`, `{type}`).

Search engines index dynamic pages poorly (one URL, content loaded by JavaScript). For SEO,
use CMS items, filled by the [sync](../server/README.md).

## Loading, error and not-found states

Every product scope and product list gets `tether-state="loading | ready | error"` (and
`updating` while a rendered product refreshes after a country switch; its content stays visible). On failure
it also gets `tether-error="not-found"` or an error code (`NETWORK`, `HTTP_401`, …).
Inside a scope, `tether-show` follows the state:

| `tether-show` | Visible when                                                                                |
| ------------- | ------------------------------------------------------------------------------------------- |
| `loading`     | waiting for Shopify                                                                         |
| `ready`       | the product/list rendered                                                                   |
| `not-found`   | the handle doesn't exist, isn't published to the Headless channel, or the URL has no handle |
| `error`       | Shopify couldn't be reached or refused the request (bad token, outage, network)             |
| `cart-error`  | (outside products) the last cart action failed; hidden again after the next one succeeds    |

Give the `error` / `not-found` blocks a class with `display: none` in Webflow, so they stay hidden
if JavaScript doesn't run at all. Tether shows them when needed (as `block`, or the value of
`tether-display`, e.g. `tether-display="flex"`). This works for every `tether-show` condition:
an element hidden with a class, `style="display:none"` or `hidden` is shown when it applies. Add-to-cart buttons in a failed scope are
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
<select tether-country-select tether-country-label="{name} ({currency})" tether-countries="NL,DE,BE"></select>
<span tether-country-bind="currency"></span>   <!-- name | code | currency | symbol -->
```

It lists the countries from your Shopify Markets (`localization.availableCountries`), or only
the ones in `tether-countries`, in that order. Choosing one
calls `Tether.setCountry(code)`, which updates `@inContext`, moves the cart to that market
(`buyerIdentity.countryCode`, so cart prices and checkout currency follow), re-renders every product
and list on the page (selections are kept) and remembers the choice. A saved cart from another
market is moved automatically on the next page load; switching never creates a cart. Responses
that were still on their way from the old market are ignored. Event: `tether:country-changed`.
The money format follows a `markets.locales` entry for that country (`locale`), or
`Tether.setCountry('DE', { locale: 'de-DE' })`; it's remembered with the country. With a
`language`, Shopify translates option names; `tether-option-list="Size"` keeps working (matched by position).

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

| Attribute                                           | Value                                                            |                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tether-product`                                    | handle, numeric id, gid, product URL, `url:handle` or `url:path` | Root of a product. Bind to the CMS handle field, or read it from the URL                                                                                                                                                                                   |
| `tether-page-title`                                 | e.g. `{title} \| Shop`                                           | Sets the page title when the product loads                                                                                                                                                                                                                 |
| `tether-variant`                                    | variant id                                                       | Preselect a variant (`?variant=` in the URL also works)                                                                                                                                                                                                    |
| `tether-quantity`                                   | number                                                           | Start quantity (allows 0, for build-a-box)                                                                                                                                                                                                                 |
| `tether-bind`                                       | see below                                                        | Fill text / image / link                                                                                                                                                                                                                                   |
| `tether-option-list`                                | option name, e.g. `Size`                                         | Repeater: first child is the button template. An empty template gets the value as text; or put `tether-bind="option-value"` (and `tether-bind="swatch"`) inside it. `tether-hide-single` hides the list when there's only one value                        |
| `select[tether-option]`                             | option name                                                      | Native select for an option                                                                                                                                                                                                                                |
| `select[tether-variant-select]`                     |                                                                  | One select with all variants                                                                                                                                                                                                                               |
| `tether-option-selected`                            | option name                                                      | Shows the selected value                                                                                                                                                                                                                                   |
| `tether-qty`, `tether-qty-plus`, `tether-qty-minus` |                                                                  | Quantity input and buttons                                                                                                                                                                                                                                 |
| `tether-line-attribute`                             | key                                                              | Input/checkbox whose value goes on the cart line (engraving, gift note)                                                                                                                                                                                    |
| `tether-line-attributes`                            | JSON                                                             | Fixed line attributes, e.g. `{"_source":"pdp"}`                                                                                                                                                                                                            |
| `tether-add-to-cart`                                |                                                                  | Button. Optional `tether-adding-text` (while adding), `tether-soldout-text` (sold-out variant), `tether-subscribe-text` (a plan is selected), inner `[tether-add-label]` for the text. In React/JSX write value-less attributes as `tether-add-to-cart=""` |
| `tether-variant-url`                                |                                                                  | On a scope: `?variant=` follows the choice (shareable links). Global: `variantUrl: true` for the page's main product                                                                                                                                       |
| `tether-show`                                       | condition                                                        | Shows/hides, see conditions                                                                                                                                                                                                                                |

`tether-bind` values: `title`, `description` (the HTML written in Shopify, through an allow-list:
text formatting, lists, tables, images, links, inline `style` and video embeds stay; scripts, event
handlers, `javascript:` links, `<style>` blocks, form fields, `id`s and `class`es (so a description
can't borrow your overlay or modal classes) are removed; other elements are unwrapped, so their text
stays; inline styles lose `position`, `top`/`right`/`bottom`/`left`/`inset`, `z-index`, transforms
(`transform`, `translate`, `rotate`, `scale`), `offset-*`, `-webkit-box-reflect`, negative
margins, values in viewport units (`100vw`) and any value with `url(`, so a description can't be
laid over the page or load from elsewhere. Negative `letter-spacing` and `word-spacing` stay down to
`-4px` or `-0.25em` (tight tracking such as `-0.02em` looks as written), and a negative
`text-indent` down to `-40px`; a value beyond that, in another unit, or with `var()`/`calc()` is
removed.
Outlines, `box-shadow`, `text-shadow`, `filter`, border-image and mask-border outsets, text
decoration (thickness and underline offset included) and `-webkit-text-stroke` paint beyond the
element, so they are kept only while every number in them, apart from colours and colour filters (`brightness()`, `opacity()`,
`hue-rotate()` and the like), is a `px` length of
at most 40px or zero: one in `em`, `%`, any other unit or none (`border-image-outset: 2`), or with
`var()`/`calc()`, removes the declaration (`box-shadow: 0 0 1em #0003` goes; write
`0 0 16px #0003`). Content wider than the element still overflows beside it, as in any HTML (Tether doesn't
clip it, which would cut off wide tables and embeds); add `contain: paint` to the element in your
own CSS if you want it clipped;
iframes are kept only from YouTube (`www.youtube.com`, `www.youtube-nocookie.com`), Vimeo
(`player.vimeo.com`), Loom (`www.loom.com`), Wistia (`fast.wistia.net`) and the origins in the
`embedOrigins` option, never from the site's own origin, run sandboxed, and may only ask for
`autoplay`, `encrypted-media`, `picture-in-picture`, `fullscreen`, `clipboard-write`,
`accelerometer`, `gyroscope` and `web-share`; links that open a new tab get
`rel="noopener noreferrer"`), `description-text`, `vendor`, `type`,
`handle`, `published-at`, `price`, `total-price`, `compare-at-price`, `unit-price`, `min-price`,
`max-price`, `discount-percentage`, `discount-amount`, `variant-title`, `variant-id`, `sku`,
`barcode`, `stock`, `quantity`, `featured-image`, `variant-image`, `image:N` (nth image), `images` (repeater), `tags`
(repeater, `exclude="a,b"`), `link`/`url` (href to `productPath`), `metafield:namespace.key`
(add the metafield to `config.metafields`), plus the subscription binds below.

Images accept `max-width`, `max-height`, `crop` for Shopify CDN resizing (or, as valid HTML,
`tether-max-width` / `data-max-width`, and the same for the others).

Classes Tether sets: option buttons get `is-selected` (+ `aria-pressed`) and `is-unavailable` when no
available variant has that value with the other choices. Clicking an unavailable value picks the
closest variant that has it and keeps the other choices where possible; a value no variant has is
ignored. Add-to-cart gets `is-disabled` (+ `aria-disabled`, `disabled`) when the variant is sold out.
The variant first selected is the one in `?variant=` / `tether-variant`, else the first available one.
Cards: `price` is that variant's price; `min-price` shows "from" prices.

### Subscriptions

Create a selling plan in your subscription app (Shopify Subscriptions, Recharge, …) and add the
product to it. Tether reads the plans via the Storefront API.

| Attribute                                                               |                                                                                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `tether-purchase="one-time"` / `"subscription"`                         | Toggle buttons (or radios). `select[tether-purchase]` also works                                                        |
| `tether-plan-list` (value: group name, or empty / `all` for every plan) | Repeater of plans. Inside: `tether-plan-bind="name \| description \| price \| savings \| savings-amount \| adjustment"` |
| `select[tether-plan]`                                                   | Select with "One-time purchase" + plans. `tether-one-time-label` sets the label                                         |
| `tether-default-purchase="subscription"`                                | On the product root. Global: `defaultPurchase`                                                                          |
| `tether-default-plan="Every month"`                                     | Plan id, name or option value. `?selling_plan=` in the URL also works                                                   |

Binds: `price` follows the selected mode. Also `one-time-price`, `subscription-price`,
`subscription-savings` (`10%`, `10 %` in German/French), `subscription-savings-amount`,
`checkout-charge` (what the visitor pays today for the chosen quantity; more for prepaid plans),
`plan-name`, `plan-description`, `plan-group`. Inside a plan list, `tether-plan-bind="option"` gives
the plan's option value ("1 month") without the price text some apps put in plan names.

Products that can only be bought on a subscription (`requiresSellingPlan`): the one-time button gets
`is-unavailable`, the cart's plan select leaves out one-time, and `cart.add()` without a plan is
refused by Shopify.

The product root gets class `is-subscription` and `tether-purchase-mode`. Selected buttons get
`is-selected` + `aria-pressed`. Plans the current variant can't use get `is-unavailable`, and
Tether switches to a plan the variant does have.

### Conditions (`tether-show`)

Product: `in-stock`, `out-of-stock`, `backorder`, `low-stock` (5 or fewer, `lowStock` to change;
needs the inventory permission), `plenty-in-stock` (in stock, not low), `on-sale`, `not-on-sale`,
`has-variants`, `single-variant`, `subscription-available`, `subscription-unavailable`,
`subscription-only`, `one-time-available`, `subscription-selected`, `one-time-selected`,
`has-savings`.

Cart (outside product scopes): `cart-empty`, `cart-filled`, `cart-has-subscription`,
`cart-no-subscription`, `cart-has-discount`, `cart-error`, `cart-warning` (Shopify changed the
last request, e.g. less stock than asked; the message goes in `[tether-cart-warning]`).

State (products and lists): `loading`, `ready`, `error`, `not-found` (see above).

Lists: `list-empty`, `list-filled`.

Hidden before the script runs (a class, `style="display:none"` or `hidden`)? Tether shows the element
when its condition is true: as its normal display, or `block` / `tether-display="flex"` when a class
hides it. Mind CSS order: a hiding class defined before your layout class (`.grid { display: grid }`)
loses to it.

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
`tether-products="url:q"` searches for the page's `?q=`: a search results page on a static site.
`tether-recommendations="<handle>"` lists related products (`url:handle` on a dynamic product page;
empty inside a `tether-product`: that product). `tether-products=""` lists all products. Search
syntax caveat: Shopify matches words loosely, so `handle:a OR handle:b` can return other products, and
search only covers the store's default language. `tether-sort` takes the Shopify
sort keys (`BEST_SELLING`, `PRICE`, `CREATED`, `TITLE`, …), with `tether-reverse="true"`.
Lists, and `Tether.getProducts()` and `Tether.getRecommendations()`, are an optional part (2 KB) that
loads with a page's first list. A list shows its loading state at once, but its first query waits
for that file, one more request on the way to the first cards. On a script-tag page where the list
is the main content, such as a collection page, preload it from the exact release the core loads its
parts from, with the file's [`integrity`](https://www.srihash.org/) hash:

```html
<link
  rel="preload"
  as="script"
  href="https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@vX.Y.Z/dist/tether.lists.min.js"
  integrity="sha384-…"
  crossorigin="anonymous"
/>
```

A core on `@X.Y` loads its parts from its own `@vX.Y.Z`, so such a preload names the release the
core is on, and is updated with it: a preload of another release is downloaded for nothing.

Using Webflow CMS lists instead? Put `tether-product` on each CMS item, bound to the handle.

### Search as you type

```html
<form tether-search action="/search">            <!-- Enter without a choice: your results page -->
  <input tether-search-input name="q" type="search" placeholder="Search">
  <div tether-search-results>
    <div tether-search-products><a><img tether-search-bind="image" max-width="80" alt=""><span tether-search-bind="title"></span> <span tether-search-bind="price"></span></a></div>
    <div tether-search-collections><a><span tether-search-bind="title"></span></a></div>
    <div tether-search-queries><a><span tether-search-bind="text"></span></a></div>
    <p tether-show="search-empty">No results</p>
  </div>
</form>
```

Shopify's predictive search, in its own optional part (3 KB) that loads only on pages with
`tether-search`. Each list's first child is the template; lists without results are hidden. The
root gets `is-open` and `tether-search-state` (`loading`, `ready`, `empty`, `error`); the input is
a combobox (arrow keys, Enter, Escape) for screen readers. `tether-search-limit` (default 6),
`tether-search-min` (characters, default 2). Event: `tether:search`.

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

| Attribute                                                                                       |                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tether-cart-drawer`                                                                            | Gets `is-open` (`cartDrawerOpenClass`), dialog semantics, focus handling; closed it's `aria-hidden` and `inert`. Value `manual` = never auto-opened. `tether-cart-label` sets its label (default "Cart")                                                           |
| `tether-cart-open` (toggles), `tether-cart-close`                                               | Esc also closes                                                                                                                                                                                                                                                    |
| `tether-cart-count`, `tether-cart-subtotal`, `tether-cart-total`, `tether-cart-checkout-charge` |                                                                                                                                                                                                                                                                    |
| `tether-cart-lines`                                                                             | Keyed repeater; the first child is the line template                                                                                                                                                                                                               |
| `tether-line`                                                                                   | `warning` (Shopify's note on this line), `title`, `variant-title`, `options`, `vendor`, `sku`, `price`, `compare-at-price`, `line-total`, `line-subtotal`, `quantity` (text or input), `image`, `url`, `plan`, `plan-description`, `components`, `attribute:<key>` |
| `tether-line-plus`, `tether-line-minus`, `tether-line-remove`                                   | Quick clicks add up; the new quantity shows at once and the line gets `is-busy` / `aria-busy` until Shopify answers                                                                                                                                                |
| `select[tether-line-plan]`                                                                      | Change frequency or switch to one-time, inside the cart                                                                                                                                                                                                            |
| `tether-line-show`                                                                              | `subscription`, `one-time`, `on-sale`, `has-components`, `warning`. Lines with a warning get `is-warning`                                                                                                                                                          |
| `tether-discount-form` + `tether-discount-input`                                                | A `<form>` with the input and a submit button. A bad code: `is-invalid` on the form, `aria-invalid` on the input, the code isn't kept; show your message with CSS (`.is-invalid .msg`) or on `tether:discount-invalid`                                             |
| `tether-cart-discounts`                                                                         | Repeater with `tether-discount="code"` and `tether-discount-remove`                                                                                                                                                                                                |
| `textarea[tether-cart-note]`                                                                    | Order note                                                                                                                                                                                                                                                         |
| `tether-checkout`                                                                               | Goes to Shopify checkout (`checkoutTarget: '_blank'` for a new tab)                                                                                                                                                                                                |
| `tether-cart-clear`                                                                             |                                                                                                                                                                                                                                                                    |
| `tether-account-link`                                                                           | Links to Shopify's own account pages: the account, or `="subscriptions"` (`account.subscriptionsUrl`) and `="payment"` (`account.paymentUrl`) for what stays with Shopify ([accounts](accounts.md))                                                                |
| `select[tether-country-select]`                                                                 | Country selector (Shopify Markets). `tether-country-label="{name} ({currency})"`                                                                                                                                                                                   |
| `tether-country-bind`                                                                           | `name`, `code`, `currency`, `symbol` of the current country                                                                                                                                                                                                        |

---

### Customer accounts and analytics

Login, orders and a checkout that knows the customer: [customer accounts](accounts.md).
GA4 / Tag Manager events and Shopify's analytics: [analytics](analytics.md).

### Other markets on static sites

While a visitor's market differs from the one a page was built for, `<html>` has the class
`tether-market-pending` until the live prices are in (one request). Hide prices meanwhile:
`html.tether-market-pending [tether-bind*="price"] { visibility: hidden }`.

## JavaScript API

```js
await Tether.ready;
Tether.cart.add({ variantId, quantity: 2, sellingPlanId, attributes: { Engraving: 'R.K.' } });
Tether.cart.add([lineA, lineB]);                  // one request
Tether.cart.updateLine(lineId, 3);
Tether.cart.updateLine(lineId, { sellingPlanId: null });  // to one-time
Tether.cart.changeQuantity(lineId, +1);           // your own +/- buttons: quick clicks add up
Tether.cart.removeLine(lineId); Tether.cart.clear();
Tether.cart.setNote('…'); Tether.cart.setAttributes({ source: 'quiz' });
await Tether.cart.applyDiscount('WELCOME10');    // rejects with code INVALID_DISCOUNT (and drops it)
Tether.cart.removeDiscount('WELCOME10'); Tether.cart.setDiscountCodes(['A', 'B']);
Tether.cart.setBuyerIdentity({ countryCode: 'DE' });
Tether.cart.warnings;                             // [{ code, message, target }] from the last change (a copy)
Tether.cart.open(); Tether.cart.checkout();      // open/close also work without a drawer; checkout() answers the URL
Tether.cart.subscribe((cart, { count, open, loaded, warnings }) => {});  // your own cart UI
Tether.cart.setCheckoutResolver(async () => url);  // a logged-in checkout URL (the account part sets it); null clears

const p = await Tether.getProduct('coffee-box');  // batched + cached
const { products, pageInfo } = await Tether.getProducts({ collection: 'coffee', first: 12 });
const scope = Tether.getScope(el);
scope.selectPlan('Every month'); scope.setPurchase('one-time');
scope.purchase;  // { kind: 'subscription', planId } or { kind: 'one-time', offeredPlanId } (read-only)

Tether.query(`query { shop { name } }`);          // anything else in the Storefront API: `data`, as an object to check
Tether.plans.planSavings(variant, planId);        // selling plan helpers

Tether.on('cart-updated', ({ cart }) => {});
await Tether.diagnose();                          // what's wrong on this page (see Troubleshooting)
await Tether.setCountry('DE');                    // switch market (see Markets)
Tether.config.locale;                             // the live config, read-only: Tether.init(options) changes it
Tether.cart.forgetSaved();                       // forget this device's cart: the page shows an empty one
```

Events (on `document`, prefixed `tether:`): `ready`, `product-ready`, `variant-changed`,
`product-added`, `added`, `group-added`, `cart-updated`, `cart-toggled`, `checkout`,
`list-ready`, `list-rendered`, `discount-applied`, `discount-invalid`, `layout-changed`, `product-not-found`,
`product-updated`, `country-changed`, `cart-error`, `cart-warning`, `search`, `error`, and with
[accounts](accounts.md#events) `account-login`, `account-logout`, `account-error`, `account-updated`.
`Tether.on(name, fn)` takes only these names, and calls `fn` only for the events Tether dispatched:
another script's `tether:cart-updated`, whatever its detail, doesn't reach it. A plain
`document.addEventListener('tether:…')` hears every event of that name, so check its detail yourself.

`cart-updated` carries `{ cart, reason }`, and `reason` (the `CartUpdateReason` type) is one of:

| `reason`                                           | When                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `load`                                             | the saved cart loaded, failed to load, was loaded again after an unclear failure, or was forgotten (`Tether.cart.forgetSaved()`) |
| `add`, `update`, `remove`                          | Shopify answered an add, a line change or a removal                                                                              |
| `note`, `attributes`, `discount`, `buyer-identity` | Shopify answered `setNote`, `setAttributes`, a discount change or `setBuyerIdentity`                                             |
| `pending`                                          | a quick `+`/`-` click shows its quantity before Shopify has it                                                                   |
| `settled`                                          | the last request of those clicks is done                                                                                         |

A cart UI that redraws on every `cart-updated` can skip `pending` and `settled` when it only cares
about what Shopify has.

## Config

Every `window.TETHER_CONFIG` key, which `Tether.init(options)` takes too, with its default. The
server helpers (`createStorefront()`, and `shop.config.js` with [Astro](astro.md)) read the same keys.

| Option                     | Default                    | What it does                                                                                                                                                                                                              |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`                   | none                       | The store's domain (`your-shop.myshopify.com`); `https://` and a path are stripped. Required                                                                                                                              |
| `token`                    | none                       | The public Storefront API access token (Headless channel). Required                                                                                                                                                       |
| `apiVersion`               | `'2026-07'`                | The Shopify API version (see [Troubleshooting](#troubleshooting-and-handover))                                                                                                                                            |
| `country`                  | none                       | The market's country (`'NL'`), for prices and currency ([Markets](#markets-and-localization))                                                                                                                             |
| `language`                 | none                       | The market's language (`'NL'`, `'pt-BR'`), for translations                                                                                                                                                               |
| `locale`                   | the browser's              | An `Intl` locale (`'nl-NL'`) for money and dates                                                                                                                                                                          |
| `markets`                  | `null`                     | Where the visitor's market comes from ([Markets](#markets-and-localization), and the `markets.*` rows below)                                                                                                              |
| `prefix`                   | `'tether'`                 | The attribute and event prefix: `'shop'` reads `shop-product` and sends `shop:cart-updated`. Lowercase letters, digits and `-`                                                                                            |
| `productPath`              | `'/product'`               | Product links: a folder (`/product/<handle>`) or a template with `{handle}` or `{id}` (`/shop?p={handle}`)                                                                                                                |
| `collectionPath`           | `'/collection'`            | The folder of collection links in [search results](#search-as-you-type)                                                                                                                                                   |
| `metafields`               | `[]`                       | Product metafields to fetch: `'namespace.key'` or `{ namespace, key }`                                                                                                                                                    |
| `embedOrigins`             | `[]`                       | More origins a description's iframes may load from, besides the built-in video players: `['https://video.example']`. Whatever such an origin serves is shown in the description, so add only hosts whose embeds you trust |
| `imagesFirst`              | `25`                       | Images fetched per product                                                                                                                                                                                                |
| `variantsFirst`            | `100`                      | Variants fetched per product                                                                                                                                                                                              |
| `sellingPlanGroupsFirst`   | `10`                       | Selling plan groups fetched per product                                                                                                                                                                                   |
| `sellingPlansFirst`        | `25`                       | Selling plans fetched per group, and plan allocations per variant                                                                                                                                                         |
| `collectionFirst`          | `24`                       | Products per page of a [product list](#product-lists) without `tether-limit`                                                                                                                                              |
| `retries`                  | `2`                        | How often a failed request is sent again (see **Retries** below)                                                                                                                                                          |
| `requestTimeout`           | `15000`                    | Milliseconds a Storefront API request may take, its whole answer included, before it fails as a network error, in every supported browser; `0` sets no limit (see **Retries** below)                                      |
| `maxAge`                   | `60`                       | Seconds a Shopify answer may be cached; `0` leaves it to Shopify, which can be hours                                                                                                                                      |
| `revalidate`               | `true`                     | Refreshes server-rendered products once in the background (see **Server-rendered products** below)                                                                                                                        |
| `storageKey`               | `'<prefix>:cart:<domain>'` | The `localStorage` key of the cart id                                                                                                                                                                                     |
| `cartDrawerOpenClass`      | `'is-open'`                | The class an open cart drawer gets                                                                                                                                                                                        |
| `openCartOnAdd`            | `true`                     | Opens the cart drawer after an add to cart                                                                                                                                                                                |
| `cartFocus`                | `true`                     | Moves keyboard focus into the open cart drawer, keeps Tab inside it and returns focus on close                                                                                                                            |
| `checkoutTarget`           | `'_self'`                  | `'_blank'` opens checkout in a new tab                                                                                                                                                                                    |
| `defaultPurchase`          | `'one-time'`               | `'subscription'` starts a product with selling plans on its first plan ([Subscriptions](#subscriptions))                                                                                                                  |
| `variantUrl`               | `false`                    | `?variant=` follows the visitor's choice on the page's main product                                                                                                                                                       |
| `lowStock`                 | `5`                        | `tether-show="low-stock"` at this many or fewer (needs inventory access)                                                                                                                                                  |
| `searchDelay`              | `150`                      | Milliseconds [search as you type](#search-as-you-type) waits after the last keystroke                                                                                                                                     |
| `autoMount`                | `true`                     | Mounts the page on `DOMContentLoaded`; with `false`, call `Tether.mount()` yourself                                                                                                                                       |
| `observe`                  | `false`                    | Mounts elements added later (Finsweet load more, filters); without it, call `Tether.mount(el)`: mounting twice does nothing                                                                                               |
| `astro`                    | `true`                     | Mounts on Astro's `astro:page-load` and closes the cart on navigation                                                                                                                                                     |
| `partsUrl`                 | `null`                     | The folder of the optional parts when you host them yourself: https or on your own site (see **Pinning a release** below). Without it they load beside the core                                                           |
| `analytics`                | `null`                     | GA4/GTM, Shopify's and your own analytics ([analytics](analytics.md), and the `analytics.*` rows below)                                                                                                                   |
| `account`                  | `null`                     | Customer accounts through the Worker ([accounts](accounts.md), and the `account.*` rows below)                                                                                                                            |
| `warningText`              | `null`                     | `(warning) => text`: your text for one of Shopify's cart warnings, translated by `warning.code` for instance; returning nothing keeps Shopify's                                                                           |
| `formatMoney`              | `null`                     | `(money, locale) => text`: your money format, in place of `Intl` with `locale`                                                                                                                                            |
| `onLayoutChange`           | `null`                     | `(reason) => {}` after renders changed the page's height; without it, `ScrollTrigger.refresh()` when GSAP's ScrollTrigger is on the page                                                                                  |
| `onCartOpen`               | `null`                     | `(drawers) => {}` after the cart drawer opened                                                                                                                                                                            |
| `onCartClose`              | `null`                     | `(drawers) => {}` after it closed                                                                                                                                                                                         |
| `onLineEnter`              | `null`                     | `(node) => {}` for a new cart line, to animate it in                                                                                                                                                                      |
| `onLineLeave`              | `null`                     | `(node, done) => {}` for a removed cart line: animate it out, then call `done()`                                                                                                                                          |
| `onValueChange`            | `null`                     | `(element, previousText) => {}` when a bound value's text changes, to animate it                                                                                                                                          |
| `onError`                  | `null`                     | `(error, context) => {}` for every failure that reaches the visitor                                                                                                                                                       |
| `debug`                    | `false`                    | Logs Tether's steps, such as retries, in the console                                                                                                                                                                      |
| `markets.detect`           | the saved choice only      | `true` reads every source, a list (`['saved', 'server', 'webflow']`) only those, `false` none                                                                                                                             |
| `markets.locales`          | none                       | Webflow locale (subdirectory or `<html lang>`) to `{ country, language, locale }`                                                                                                                                         |
| `markets.cookie`           | `'tether_country'`         | The cookie your server sets with the visitor's country                                                                                                                                                                    |
| `markets.remember`         | `true`                     | Remembers the visitor's own choice (`tether-country-select`, `Tether.setCountry()`)                                                                                                                                       |
| `markets.strict`           | `false`                    | With `locales`: an `<html lang>` that isn't in the map gives no market                                                                                                                                                    |
| `analytics.dataLayer`      | off                        | GA4/GTM events: `true` into `window.dataLayer`, a name into that global array                                                                                                                                             |
| `analytics.shopify`        | off                        | Shopify's own analytics: `true` or `{ consent, proxy }` ([analytics](analytics.md))                                                                                                                                       |
| `analytics.onEvent`        | none                       | `(name, data) => {}` for every analytics event                                                                                                                                                                            |
| `account.server`           | none                       | The Worker's account routes: a path on your site (`'/_tether/account'`) or an https URL. Without it accounts are off                                                                                                      |
| `account.orderUrl`         | Shopify's order page       | Your own order page, with `{id}` for the numeric order id                                                                                                                                                                 |
| `account.subscriptionsUrl` | the shop's `/account`      | Shopify's subscription management page                                                                                                                                                                                    |
| `account.paymentUrl`       | `subscriptionsUrl`         | A separate page for payment methods                                                                                                                                                                                       |
| `account.logoutUrl`        | the home page              | Where Shopify sends the visitor after logout                                                                                                                                                                              |
| `account.locale`           | the language of `locale`   | The language of Shopify's login pages (`'nl'`)                                                                                                                                                                            |
| `account.navigate`         | `location.assign`          | `(url) => {}` in place of the login redirect, to open it in a popup for instance                                                                                                                                          |

**Retries (`retries`, default 2).** A query that failed on the network, with a 429 or 5xx, or with
Shopify's `THROTTLED` or `INTERNAL_SERVER_ERROR` is sent again, up to `retries` times. A mutation,
add to cart and every other cart change included, is sent again only after a 429 or `THROTTLED`,
which Shopify answers without running it: after a network error or a server error Shopify may
already have applied it, so Tether doesn't send it twice, and a failed cart change loads the cart
again to show what Shopify has. The first retry waits 300 ms (500 ms after `THROTTLED`), and each
later one twice as long as the one before.

A request that has no complete answer after `requestTimeout` milliseconds (15 seconds by default)
is stopped and counts as a network error (`NETWORK`): a query is sent again, a cart change isn't,
and the cart is loaded again. So a connection that stalls fails the change with `tether:cart-error`
instead of holding every cart change behind it. `requestTimeout` and `searchDelay` go up to
2147483647 (about 24 days), the longest delay a browser's timer keeps: a longer one would fire at
once, so it logs a warning and the default is used.

**Validation.** Every option is checked once, when Tether starts. An option Tether doesn't know (a
typo such as `openCartOnAd`) logs a warning and is left out. A value it can't use logs a
warning in the console and falls back to the default (or is left out): `apiVersion` must be a
quarterly version (`2026-07`; `unstable` works, with a warning), `domain` a host name (`https://` and
a path are stripped), `locale` a locale `Intl` accepts, `country` and `language` codes Shopify
knows (written as you like: `'de'` becomes `DE`, `'pt-br'` becomes `PT_BR`), and the `account` URLs
a path on your site or an https URL (http only on localhost). So is `partsUrl` (or an http URL on the
page's own origin); one elsewhere is left out, and the parts load beside the core. Each
`embedOrigins` entry must be an https origin alone (no path or query); any other entry is left out.

**Server-rendered products.** The products in a `<script type="application/json" data-tether-hydrate>`
tag (`shop.hydrate()`) are shown without a request, prices included, until the background refresh
replaces them. The tag is trusted as part of the page, like its other HTML and scripts: it is written
by the site's own build, and whoever can add one to a page can already add a script. An entry
missing the lists and prices a render walks (a truncated or hand-written tag) is skipped, and that
product loads from Shopify instead. `Tether.mount()` reads every tag in the document; with `observe`,
the elements added later are read and mounted on their own, once per burst of additions.

**Pinning a release.** A minor line in the URL, like the README's
[script tag](../README.md#install) (`@X.Y`), takes every X.Y.Z fix automatically,
which is what most sites want. To pin exactly what runs, load a fixed release (`@vX.Y.Z`, a tag from
the [Releases](https://github.com/ravi-klaassens/tether/releases)) and add the file's
[`integrity`](https://www.srihash.org/) hash to the script tag (an `integrity` hash on `@X.Y` breaks
with the next fix). The optional parts load from the core's own release folder, or from
`partsUrl`: a core loaded through a jsDelivr alias (`@X.Y`, `@latest` or no version) loads them from
its exact release (`@vX.Y.Z`, or `@X.Y.Z` for npm), so a cached core never meets a newer part. They
are always checked against hashes built into the core, so a core runs only the parts of its own
release. A `partsUrl` therefore has to serve the files of the same release as the core: upload the
whole folder of that release (every `tether.*.js` from its GitHub Release or `dist/`) and replace it
together with the core. The browser refuses a part from another release, so it fails to load.
Parts on another origin than the page load with CORS (jsDelivr sends the headers; your own host must
too), and a `partsUrl` has to be https or on your own site.

**Optional parts.** These live in separate files that load on first use, next to the main script
(jsDelivr serves them from the same folder) or at `partsUrl`, and as split chunks in a bundler:
`tether.lists.min.js` (product lists, `Tether.getProducts()`, `Tether.getRecommendations()`),
`tether.search.min.js` (search as you type), `tether.markets.min.js` (`markets.detect`,
`tether-country-select`, `Tether.setCountry()`), `tether.extras.min.js` (bundles, `?variant=`),
`tether.account.min.js` and `tether.account-pages.min.js` (customer accounts),
`tether.analytics.min.js` (analytics) and `tether.diagnose.min.js` (`Tether.diagnose()`). So
`Tether.getProducts()`, `Tether.getRecommendations()`, `Tether.detectMarket()` and
`Tether.getLocalization()` return promises. The script build finds its folder from its own
`<script src>`: a core bundled into another file, inlined, or loaded with `type="module"` sets
`partsUrl` to a folder with the same release's parts.

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
Errors are `TetherError`s with `code` (`NOT_FOUND`, `NETWORK`, `HTTP_401`, `NOT_CONFIGURED`,
`INVALID_COUNTRY`, `INVALID_DISCOUNT`, `INVALID_RESPONSE` for a 2xx answer that isn't valid
GraphQL, `SERVER_ERROR` for a 2xx answer with Shopify's `INTERNAL_SERVER_ERROR` or, for a mutation,
GraphQL errors without `data`; accounts add [their own](accounts.md#errors)), `status`, `errors` (GraphQL) and `userErrors` (cart). For Sentry:

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
2. `TETHER_API_VERSION=$(node scripts/api-version.ts --next) npm run smoke` (and against your dev
   store with `TETHER_DOMAIN`/`TETHER_TOKEN`) to check every Tether query against the next version.
3. Bump the versions in `server/src/shared/api-versions.ts` (the browser script's default and the
   Worker's both come from there), run `npm test`, release. Sites can also set `apiVersion` in
   `TETHER_CONFIG` themselves.

**Weekly check.** [`.github/workflows/smoke.yml`](../.github/workflows/smoke.yml) runs `npm test` and the
smoke test against the pinned _and_ the next quarterly API version, every Monday and on every push
to `main`. When something fails it opens an issue (label `smoke-failure`), or comments on the open
one. In a fork, enable Actions on the fork's Actions tab. Optionally add the repository secrets
`TETHER_DOMAIN` and `TETHER_TOKEN` (a public Storefront token of your test store) to test your own
store, selling plans included; without them it uses Shopify's public demo store. A run takes
1–2 minutes, and Actions minutes are free on public repositories.

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
node scripts/api-version.ts --next                             # the next quarterly version
```

**Releases:** write the `## X.Y.Z` section in `CHANGELOG.md`, then

```bash
npm run release -- X.Y.Z --push
```

It first checks that the `ci` workflow passed on GitHub for the commit it releases (through `gh`,
which must be logged in). It bumps the version everywhere (packages, `VERSION`, the sync, README
pins, `server/TETHER_VERSION` for a new minor), builds, refuses a release commit that changes
anything else, runs the versions test and the live smoke test, commits, tags and pushes. It doesn't
run the whole gate again: a test that fails only at a new version is caught on the pull request by
the `release-rehearsal` workflow, which writes the next minor and the next patch version into a
worktree with the release's own rewrite (`node scripts/release.ts --rewrite-only X.Y.Z <folder>`)
and runs `npm run check` there. It runs on pull requests that change `src/`, `server/`, `scripts/`,
`test/`, the package files or the README.

The `release` workflow then runs on the tag, in this order:

1. It refuses a tag whose commit isn't in main's history (deployed sync Workers install only
   those), or, when the tag's `release/X.Y` branch exists, isn't on that branch.
2. It checks that the committed `dist/` is a fresh build, and runs the gate and the smoke test again.
3. It creates the GitHub Release, with the browser scripts and `tether-server-X.Y.Z.tar.gz`, the
   sync Worker's `server/` folder, attested by the workflow. Deployed sync Workers install only that
   file, and pick the release up through their Update Tether action within their range. The ES
   module build (`tether.esm.js` and `esm/`) is left out of the Release: bundlers take it from npm.
4. It publishes to npm with provenance (npm trusted publishing, no token in the repo). It comes
   after the GitHub Release, so a failed publish doesn't hold back the Workers, and can be run again
   on its own.
5. It purges jsDelivr's alias URLs of the release's files (`@X.Y`, and for the newest release `@X`,
   `@latest` and no version): the `gh/` ones once the GitHub Release exists, the `npm/` ones once
   npm has the version. A failed purge warns; the alias then updates when jsDelivr's cache of it
   expires, within 7 days.

Exact URLs (`@vX.Y.Z`, and `@X.Y.Z` on npm) work as soon as the tag and the npm version exist; alias
URLs serve the new release once they are purged.

With `--push`, `npm run release` then waits up to 20 minutes for npm to have the version and locks
the Astro starter on it (its range and its lockfile, in one commit it pushes to main), so `npm ci`
works in the starter and in projects made from it. When npm takes longer, it prints the command that
does that step alone: `npm run release -- X.Y.Z --starter --push`. A maintenance release leaves
main's starter alone.

**Maintenance releases:** a fix for an older minor line X.Y is released from its branch
`release/X.Y`, made once from that line's last tag (`git push origin vX.Y.Z:refs/heads/release/X.Y`)
and given `scripts/release.ts`, `scripts/release-version.ts`, `.github/workflows/release.yml` and
`.github/workflows/ci.yml` from main, since a tag runs the workflow at its own commit and a push to
the branch runs its own `ci.yml`, whose passing run the release needs. Check out
`origin/release/X.Y` and run the same command. The script also
records the release commit in main's history, by a merge commit that changes only main's
`CHANGELOG.md`, and pushes the branch, main and the tag together. The release isn't GitHub's latest
release, and goes to npm under the `latest-X.Y` dist-tag instead of `latest`.

## Subscriptions after checkout

Tether gets the subscription into the cart with the right plan. Checkout, the recurring charge and
the contract are Shopify's. With [customer accounts](accounts.md) through your Worker, customers
skip, unskip, pause, resume and cancel a subscription on your own pages
([how](accounts.md#on-your-own-site-order-pages-profile-addresses-subscriptions-returns)). Everything
else, such as swapping a product or changing the card, stays in your subscription app's portal in
Shopify customer accounts, and so does all of it without accounts. Test those flows in a Shopify
dev store with payments in test mode.
