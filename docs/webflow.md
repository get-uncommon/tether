# Tether with Webflow

Setting up Tether with the script tag, step by step: in Webflow, or on any page without a build
step. With Astro, see the [Astro guide](astro.md); with Next.js, SvelteKit, Vite or Eleventy,
[other frameworks](frameworks.md).

## Three ways to install

|                           | Pick it when                                                                    | How                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Script tag** (jsDelivr) | a static site or Webflow, no build step, no login needed                        | the script tag from the [README](../README.md#install) ([steps below](#2-add-the-script-to-webflow))               |
| **npm**                   | Astro, Vite or another bundler or framework                                     | `npm install @occluze/tether` ([Astro guide](astro.md), [other frameworks](frameworks.md))                         |
| **With the Worker**       | you also want the CMS sync, rebuilds when products change, or customer accounts | either of the above, plus your own free Cloudflare Worker ([Worker](../server/README.md), [accounts](accounts.md)) |

The script tag pinned to one release: `…/tether@vX.Y.Z/dist/tether.min.js`. Its optional parts
(search, accounts, markets, analytics) load from the core's release folder when a page uses them
(from `@vX.Y.Z` even when the script tag says `@X.Y`), each checked against a hash built into the
core. To host them yourself, put the same release's files in one folder
and set `partsUrl`. Customer accounts need the Worker ([setup](accounts.md#setup)): it keeps the
customer's tokens, so the browser never holds one.

## 1. Connect Shopify (5 minutes)

1. Shopify admin → install the free **Headless** channel → Create storefront → copy the
   **public Storefront API token**. (Never an Admin API token: this one is visible in the browser.)
2. Same page → Storefront API permissions: product listings, product inventory, product tags,
   checkouts (read + write) and selling plans.
3. Products → select all → Include in sales channels → **Headless**.

## 2. Add the script to Webflow

Site settings → Custom code → **Head**: the config, then the script tag. The
[README's quick start](../README.md#quick-start) has both with the current version filled in; here
`X.Y` stands for it:

```html
<script>
  window.TETHER_CONFIG = {
    domain: 'your-store.myshopify.com',
    token: 'PUBLIC_STOREFRONT_TOKEN',
    country: 'NL',               // prices and currency for this market
    locale: 'nl-NL',             // how money is written
    productPath: '/product',     // your Webflow product template
  };
</script>
<script src="https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@X.Y/dist/tether.min.js" defer></script>
```

### Versions and self-hosting

`@X.Y` gets every X.Y.x fix automatically (recommended), `@vX.Y.Z` pins one release (add its
[`integrity`](reference.md#config) hash to pin exactly what runs), `@latest` always takes the newest.
Hosting the file yourself? Put the optional parts next to it (`tether.markets.min.js`,
`tether.search.min.js`, `tether.account.min.js`, `tether.account-pages.min.js`,
`tether.analytics.min.js`, `tether.extras.min.js`, `tether.diagnose.min.js`): each loads only when a
page uses it. More on pinning and `partsUrl` in the [reference](reference.md#config).

## 3. Add attributes in the Designer

Element → Settings → Custom attributes. The ones you'll use most:

| Attribute                                   | Value                                                                                   | Does                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `tether-product`                            | the Shopify handle (bind it to a CMS field)                                             | Wraps everything for one product                                              |
| `tether-bind`                               | `title`, `price`, `compare-at-price`, `description`, `featured-image`, `images`, `link` | Fills text, images and links                                                  |
| `tether-option-list`                        | an option name, e.g. `Size`                                                             | Size/colour buttons (first child is the template)                             |
| `tether-add-to-cart`                        |                                                                                         | Add-to-cart button                                                            |
| `tether-purchase`                           | `one-time` / `subscription`                                                             | Subscribe-or-buy-once toggle                                                  |
| `tether-plan-list`                          | `all`                                                                                   | The delivery frequencies (first child is the template)                        |
| `tether-show`                               | `in-stock`, `out-of-stock`, `on-sale`, `subscription-selected`, `error`, `not-found`    | Shows an element only then                                                    |
| `tether-cart-drawer`                        |                                                                                         | The cart panel (gets the class `is-open`)                                     |
| `tether-cart-open` / `tether-cart-close`    |                                                                                         | Buttons that open/close it                                                    |
| `tether-cart-count`, `tether-cart-subtotal` |                                                                                         | Cart numbers                                                                  |
| `tether-cart-lines`                         |                                                                                         | The cart lines (first child is the template, with `tether-line="title"` etc.) |
| `tether-checkout`                           |                                                                                         | Goes to Shopify checkout                                                      |

Everything else (bundles, collections, discount codes, metafields, swatches, recommendations…)
is in the [attribute reference](reference.md#attribute-reference).

**Product pages without CMS items:** use `tether-product="url:handle"` on one page and open it as
`/product?handle=coffee-box` ([more](reference.md#products-without-a-cms-item-dynamic-product-page)).

## 4. Check it

Open the site, then the browser console:

```js
await Tether.diagnose()
```

It tells you whether the token works, which products and subscription plans it found, and what's
wrong in the markup, for example a product without a handle or a field that's spelled wrong.

## Sync Shopify products to the Webflow CMS (optional)

Want a CMS item per product, for SEO, CMS lists and filtering? The sync keeps a Webflow collection
up to date with Shopify: new products appear, changes follow within seconds, deleted ones are archived.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ravi-klaassens/tether/tree/main/server)

Free on Cloudflare's free plan. It updates itself, and setup takes about 10 minutes:
[step by step](../server/README.md).

## Good to know

- **Errors:** send them to Sentry or any other tool with `onError` ([how](reference.md#troubleshooting-and-handover)).
- **Subscriptions after checkout:** with [customer accounts](accounts.md) through your Worker, customers skip,
  pause, resume and cancel on your own pages ([how](accounts.md#on-your-own-site-order-pages-profile-addresses-subscriptions-returns));
  otherwise your subscription app's portal in Shopify customer accounts handles them. Changing the card always stays with Shopify.
- **Page transitions** (Barba, Swup) and Lenis/GSAP are supported ([how](reference.md#with-page-transitions-barba-swup-)).
- **Different markets and languages:** [Markets](reference.md#markets-and-localization).
- **Testing in a dev store:** checkout sits behind the store password, and payments need test mode.
