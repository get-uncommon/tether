<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@main/.github/header-dark.svg">
  <img src="https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@main/.github/header-light.svg" alt="Tether" width="400">
</picture>

**Shopify products, cart and subscriptions in Webflow or Astro, with HTML attributes.**

[![npm](https://img.shields.io/npm/v/@occluze/tether?colorA=000000&colorB=3DE72E)](https://www.npmjs.com/package/@occluze/tether)
[![size](https://img.shields.io/badge/gzipped-29%20KB-3DE72E?labelColor=000000)](https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@0.9/dist/tether.min.js)
[![license](https://img.shields.io/npm/l/@occluze/tether?colorA=000000&colorB=3DE72E)](LICENSE)

## Install

Script tag, for Webflow or any page without a build step:

```html
<script src="https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@0.9/dist/tether.min.js" defer></script>
```

`@0.9` gets every 0.9.x fix automatically (recommended), `@v0.9.4` pins one release, `@latest`
always takes the newest ([versions and self-hosting](docs/webflow.md#versions-and-self-hosting)).

npm, for Astro, Vite or another bundler or framework (TypeScript types included):

```bash
npm install @occluze/tether
```

```js
import Tether from '@occluze/tether';
```

## Quick start

In Webflow: Site settings → Custom code → **Head**. The token is the public Storefront API token
from Shopify's Headless channel ([how to get it](docs/webflow.md#1-connect-shopify-5-minutes)).

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
<script src="https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@0.9/dist/tether.min.js" defer></script>
```

Then add attributes in the Designer (Element → Settings → Custom attributes):

```html
<div tether-product="coffee-box">
  <h1 tether-bind="title"></h1>
  <span tether-bind="price"></span>
  <button tether-add-to-cart>Add to cart</button>
</div>
```

`await Tether.diagnose()` in the browser console tells you whether the token works and what's wrong
in the markup.

## What it does

- **Live from Shopify:** prices, stock, variants and the cart via the Storefront API. Webflow holds the design.
- **Subscriptions:** Shopify selling plans (Shopify Subscriptions, Recharge, Skio, Loop, Appstle, …).
- **With or without the CMS:** bind products to CMS items, or let one page show any product from the URL.
- **Markets:** local prices and currency, a country selector, Webflow Localization.
- **Optional CMS sync:** a Webflow CMS item per Shopify product, kept up to date automatically by your own free Cloudflare Worker.
- **Product lists, search as you type, customer accounts, analytics:** optional parts that load only where you use them.
- **Astro too:** build-time product pages with live prices and cart, View Transitions included.
- **Hand-over ready:** loading, error and not-found states, `Tether.diagnose()`, error reporting.
- **Free and open source:** an alternative to Smootify and Storesynk (formerly Shopyflow). One script tag, no monthly fee, no dependencies.

## Docs

- [Webflow, step by step](docs/webflow.md): connect Shopify, the script, the attributes you'll use most
- [Reference](docs/reference.md): every attribute, the JavaScript API, config, troubleshooting, development and releases
- [Astro](docs/astro.md) ([starter](examples/astro)) and [other frameworks](docs/frameworks.md): Next.js, SvelteKit, Vite, Eleventy
- [CMS sync Worker](server/README.md): a Webflow CMS item per Shopify product, and rebuilds when products change
- [Customer accounts](docs/accounts.md) and [analytics](docs/analytics.md): GA4/Tag Manager and Shopify's own
- [How it compares](docs/comparison.md) with Smootify and Storesynk
- [Changelog](CHANGELOG.md) and [contributing](.github/CONTRIBUTING.md)

## License

MIT © Ravi Klaassens · [occluze.com](https://occluze.com)
