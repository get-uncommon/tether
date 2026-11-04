# Tether

**Shopify products, cart and subscriptions in Webflow or Astro, with HTML attributes.**
An open-source, free alternative to Smootify and Storesynk (formerly Shopyflow): one script tag, no monthly fee.
[How it compares →](docs/comparison.md)

```html
<div tether-product="coffee-box">
  <h1 tether-bind="title"></h1>
  <span tether-bind="price"></span>
  <button tether-add-to-cart>Add to cart</button>
</div>
```

- **Live from Shopify:** prices, stock, variants and the cart via the Storefront API. Webflow holds the design.
- **Subscriptions:** Shopify selling plans (Shopify Subscriptions, Recharge, Skio, Loop, Appstle, …).
- **With or without the CMS:** bind products to CMS items, or let one page show any product from the URL.
- **Markets:** local prices and currency, a country selector, Webflow Localization.
- **Optional CMS sync:** a Webflow CMS item per Shopify product, kept up to date automatically ([one-click deploy](#sync-shopify-products-to-the-webflow-cms-optional)).
- **Astro too:** build-time product pages with live prices and cart, View Transitions included ([Astro guide](docs/astro.md)).
- **Hand-over ready:** loading, error and not-found states, `Tether.diagnose()`, error reporting.

MIT licensed · 20 KB gzipped · no dependencies · TypeScript types · [full reference](docs/reference.md) · [comparison](docs/comparison.md) · [changelog](CHANGELOG.md)

---

## 1. Connect Shopify (5 minutes)

1. Shopify admin → install the free **Headless** channel → Create storefront → copy the
   **public Storefront API token**. (Never an Admin API token: this one is visible in the browser.)
2. Same page → Storefront API permissions: product listings, product inventory, product tags,
   checkouts (read + write) and selling plans.
3. Products → select all → Include in sales channels → **Headless**.

## 2. Add the script to Webflow

Site settings → Custom code → **Head**:

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
<script src="https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@0.5/dist/tether.min.js" defer></script>
```

**Versions:** `@0.5` gets every 0.5.x fix automatically (recommended), `@v0.5.0` pins one release,
`@latest` always takes the newest. Hosting the file yourself? Put `tether.markets.min.js` and
`tether.diagnose.min.js` next to it: those optional parts load only when a page uses markets or
`Tether.diagnose()`.

## 3. Add attributes in the Designer

Element → Settings → Custom attributes. The ones you'll use most:

| Attribute | Value | Does |
|---|---|---|
| `tether-product` | the Shopify handle (bind it to a CMS field) | Wraps everything for one product |
| `tether-bind` | `title`, `price`, `compare-at-price`, `description`, `featured-image`, `images`, `link` | Fills text, images and links |
| `tether-option-list` | an option name, e.g. `Size` | Size/colour buttons (first child is the template) |
| `tether-add-to-cart` | | Add-to-cart button |
| `tether-purchase` | `one-time` / `subscription` | Subscribe-or-buy-once toggle |
| `tether-plan-list` | `all` | The delivery frequencies (first child is the template) |
| `tether-show` | `in-stock`, `out-of-stock`, `on-sale`, `subscription-selected`, `error`, `not-found` | Shows an element only then |
| `tether-cart-drawer` | | The cart panel (gets the class `is-open`) |
| `tether-cart-open` / `tether-cart-close` | | Buttons that open/close it |
| `tether-cart-count`, `tether-cart-subtotal` | | Cart numbers |
| `tether-cart-lines` | | The cart lines (first child is the template, with `tether-line="title"` etc.) |
| `tether-checkout` | | Goes to Shopify checkout |

Everything else (bundles, collections, discount codes, metafields, swatches, recommendations…)
is in the [attribute reference](docs/reference.md#attribute-reference).

**Product pages without CMS items:** use `tether-product="url:handle"` on one page and open it as
`/product?handle=coffee-box` ([more](docs/reference.md#products-without-a-cms-item-dynamic-product-page)).

## 4. Check it

Open the site, then the browser console:

```js
await Tether.diagnose()
```

It tells you whether the token works, which products and subscription plans it found, and what's
wrong in the markup, for example a product without a handle or a field that's spelled wrong.

---

## Sync Shopify products to the Webflow CMS (optional)

Want a CMS item per product, for SEO, CMS lists and filtering? The sync keeps a Webflow collection
up to date with Shopify: new products appear, changes follow within seconds, deleted ones are archived.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ravi-klaassens/tether/tree/main/server)

Free on Cloudflare's free plan. It updates itself, and setup takes about 10 minutes:
[step by step](server/README.md).

## Good to know

- **Errors:** send them to Sentry or any other tool with `onError` ([how](docs/reference.md#troubleshooting-and-handover)).
- **Subscriptions after checkout** (skip, pause, cancel) are handled by your subscription app and
  Shopify customer accounts, not by Tether.
- **Page transitions** (Barba, Swup) and Lenis/GSAP are supported ([how](docs/reference.md#with-page-transitions-barba-swup-)).
- **Different markets and languages:** [Markets](docs/reference.md#markets-and-localization).
- **Testing in a dev store:** checkout sits behind the store password, and payments need test mode.

## Developers

```bash
npm install
npm test          # unit tests
npm run smoke     # live test against Shopify's public demo store
npm run build
```

Bundlers: `npm install @occluze/tether`, then `import Tether from "@occluze/tether"` (TypeScript
types included; markets and diagnose are split into their own chunks). Server-side data:
`@occluze/tether/server`. Astro: `@occluze/tether/astro` ([guide](docs/astro.md), [starter](examples/astro)). Next.js,
SvelteKit, Vite, Eleventy: [other frameworks](docs/frameworks.md).
JavaScript API, config, releases and the Shopify API version policy are in the [reference](docs/reference.md).

## License

MIT © Ravi Klaassens · [occluze.com](https://occluze.com)
