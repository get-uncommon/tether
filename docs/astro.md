# Tether with Astro

A Shopify store in Astro without Hydrogen: Astro builds the product pages from Shopify (real
HTML for search engines, fast first paint). Tether keeps prices, stock, variants, subscriptions
and the cart live in the browser. You write HTML attributes, not a cart.

**Quickest start:** a working shop on Shopify's public demo store. The steps below explain what's in it.

```bash
npm create astro@latest -- --template ravi-klaassens/tether/examples/astro my-shop
cd my-shop && npm install && cp .env.example .env && npm run dev
```

([the starter on GitHub](https://github.com/ravi-klaassens/tether/tree/main/examples/astro))

## 1. Install

```bash
npm install @occluze/tether
```

`.env` (the **public** Storefront API token, from Shopify's Headless channel; never an Admin token).
Use exactly these names: the integration and `createStorefront(import.meta.env)` look for them.

```bash
PUBLIC_SHOPIFY_DOMAIN=your-store.myshopify.com
PUBLIC_SHOPIFY_STOREFRONT_TOKEN=your-public-storefront-token
```

Testing without a store? Use Shopify's demo: `hydrogen-preview.myshopify.com` with the token
`3b580e70970c4528da70c98e097c2fa0`.

## 2. Config in one place

The browser and the build must agree on the market, or the browser can't reuse the build's data.
Put it in one file and use it twice:

```js
// src/shop.config.js
export default { country: 'NL', locale: 'nl-NL', productPath: '/products' };
```

```js
// astro.config.mjs: adds Tether to every page (store and token come from .env)
import { defineConfig } from 'astro/config';
import tether from '@occluze/tether/astro';
import shopConfig from './src/shop.config.js';

export default defineConfig({
  site: 'https://your-shop.com', // absolute URLs for jsonLd() and canonical links (else localhost)
  integrations: [tether(shopConfig)],
});
```

```js
// src/lib/shop.js: Shopify data at build time (or per request with SSR)
import { createStorefront } from '@occluze/tether/server';
import shopConfig from '../shop.config.js';

export const shop = createStorefront({ ...import.meta.env, ...shopConfig });
```

Functions and settings per page can go in `window.TETHER_CONFIG` in your layout's `<head>`;
it's merged into the integration's config (it doesn't start a second Tether).

`productPath` is where your product pages live: `'/products'` gives `/products/{handle}` (any
path works, `'/p'` too; `'/shop?handle={handle}'` for one dynamic page). `createStorefront` only
takes the keys it knows from `import.meta.env`, so spreading it is safe.

Every [config option](reference.md#config) works in `shop.config.js`, except functions
(`onError`, `formatMoney`, hooks): set those in `window.TETHER_CONFIG` in your layout, they are merged in.
So do `createStorefront()`'s own `siteUrl` and `pageSize`: the integration leaves them out of the page.
In dev, a change to `src/shop.config.js` restarts the dev server, so the browser and the server
render agree (another file: `tether({ ...shopConfig, watch: ['config/shop.js'] })`). `.env` follows
Astro's `--mode` (`.env.staging` with `astro build --mode staging`), and the two store variables
are declared through `astro:env`, so Astro checks them.

## 3. Product pages

```astro
---
// src/pages/products/[handle].astro
import Layout from '../../layouts/Layout.astro';
import { shop } from '../../lib/shop.js';

export async function getStaticPaths() {
  const products = await shop.allProducts();
  return products.map((product) => ({ params: { handle: product.handle }, props: { product } }));
}
const { product } = Astro.props;
const state = shop.initialState(product); // what Tether will show first
---
<Layout title={product.title}>
  <article tether-product={product.handle}>
    <img tether-bind="featured-image" src={shop.imageUrl(product.featuredImage?.url, { width: 800 })} max-width="800" alt="" />
    <h1 tether-bind="title">{product.title}</h1>
    <span tether-bind="price">{shop.formatMoney(state.price)}</span>

    {product.options.filter((o) => o.optionValues.length > 1).map((o) => (
      <div tether-option-list={o.name}>
        {o.optionValues.map((v) => (
          <button class:list={{ 'is-selected': state.selected[o.name] === v.name, 'is-unavailable': state.isUnavailable(o.name, v.name) }}>{v.name}</button>
        ))}
      </div>
    ))}

    <button tether-add-to-cart tether-soldout-text="Sold out" disabled={!state.available}>
      {state.available ? 'Add to cart' : 'Sold out'}
    </button>
    <span tether-show="low-stock" hidden={!state.show['low-stock']}>Only a few left</span>
  </article>

  <Fragment set:html={shop.hydrate(product)} />
  <Fragment set:html={shop.jsonLd(product, { url: Astro.url.href })} />
</Layout>
```

- Render the real content in the HTML (title, price, images): it's what search engines see and what
  shows before any script runs.
- `shop.hydrate(product)` puts the product data in the page. Tether renders from it straight away
  (no request, no loading state), then refreshes prices and stock **once** in the background, in one
  request for all products on the page. Leave it out and Tether fetches the products itself.
- `shop.initialState(product)` tells you what Tether will show first, by the same rules: the
  variant (the first available one, or `?variant=`), the price (the plan price for products that
  can only be bought on a subscription), `selected` options, `available`, `compareAtPrice` (only when on
  sale) and `show` (every `tether-show` condition). Render from it and nothing changes when the
  script takes over. In SSR pass the URL: `shop.initialState(product, { variant: Astro.url.searchParams.get('variant') })`.
- Tether keeps what the server rendered when it's the same (images, option buttons): no flicker.
  Products already loaded live on an earlier page of the visit aren't refreshed again. Several
  `hydrate()` tags on one page are fine.
- Classes Tether sets, to render the same on the server: `is-selected` / `is-unavailable` on option
  and plan buttons, `is-disabled` on add-to-cart when sold out (and the text of
  `tether-soldout-text`), `is-subscription` on the product when a plan is selected. Low stock is 5 or fewer.
- Subscriptions: `state.plans` (`name`, `price`, `savings`, `selected`, `available`) and
  `shop.formatPercent(state.savings)` fill `tether-plan-list` and `tether-bind="subscription-savings"`
(`30%`, or `30 %` in German and French, as Tether writes it); the
  [starter's product page](https://github.com/ravi-klaassens/tether/blob/main/examples/astro/src/pages/products/%5Bhandle%5D.astro)
  has a complete block. A product that can only be bought on a subscription shows the one-time
  price as the compare-at price.
- `shop.jsonLd(product, { url })` adds the product for search engines (Google's product results:
  price, stock and currency per variant); set `siteUrl` in `shop.config.js` to leave out `url`.
- Images: give `shop.imageUrl()` the same width as the `max-width` attribute (valid HTML:
  `data-max-width`), and Tether keeps the server-rendered image instead of loading it again. Use a
  plain `<img>`: `astro:assets`' `<Image>` rewrites the URL, so Tether can't tell it's the same image
  and replaces it (the image downloads twice). Give the first product image
  `fetchpriority="high"` and no `loading="lazy"`; lazy-load cards below the fold only.
- The attributes are the same as in Webflow: see the [attribute reference](reference.md#attribute-reference)
  (variants, subscriptions, bundles, lists, metafields, recommendations…).

**Show and hide:** `tether-show="out-of-stock"` (or `on-sale`, `subscription-available`, …) is
shown or hidden by Tether. Render the right state on the server so nothing flashes:
`hidden={!state.show['out-of-stock']}`. Cards too: `shop.initialState(p).price` is the price Tether
shows (the first available variant, or the plan price), not `priceRange.minVariantPrice` (for a
"from" price use `tether-bind="min-price"`). `show['plenty-in-stock']` is in stock and not low, for an
"In stock" line next to "Only 2 left". An element
hidden in the HTML (`hidden`, `style="display:none"` or a class) is shown when its condition is
true, as its normal display, or `block` / the value of `tether-display` when a class hides it.

**Lists:** `const { products } = await shop.getProducts({ first: 12, sortKey: 'BEST_SELLING' })`,
then one `tether-product={p.handle}` card each, and `shop.hydrate(products, { card: true })` once
(about 40% smaller: no descriptions or variant images, and two images per product, for
`tether-bind="image:2"` hover images; `{ card: true, images: 3 }` keeps more). Sort keys differ per
query: `getProducts` takes Shopify's product sort keys (`CREATED_AT`), `getCollection` the
collection ones (`CREATED`).

**Collection pages:**

```astro
---
// src/pages/collections/[handle].astro
export async function getStaticPaths() {
  const collections = await shop.allCollections();
  return collections.map((c) => ({ params: { handle: c.handle } }));
}
const collection = await shop.getCollection(Astro.params.handle, { first: 48 });
if (!collection) return Astro.rewrite('/404'); // SSR: an unknown handle
---
<h1>{collection.title}</h1>
{collection.products.map((p) => <ProductCard product={p} />)}
<Fragment set:html={shop.hydrate(collection.products, { card: true })} />
```

With `output: 'server'`, `getStaticPaths` only runs for pages marked `export const prerender = true`;
leave both out to render every collection per request.

**SSR** (`output: 'server'`): the same calls work per request. A missing product is `null`:

```astro
---
const { handle } = Astro.params;
const [product, related] = await Promise.all([shop.getProduct(handle), shop.getRecommendations(handle)]);
if (!product) return Astro.rewrite('/404'); // your 404 page, with status 404
---
```

An SSR page has just fetched fresh data, so the browser's one background refresh isn't needed:
`revalidate: false` in `shop.config.js` (or in `window.TETHER_CONFIG` on those pages) skips it.

`shop.config.ts` works the same as `.js`.

**Search page:** `shop.getProducts({ query: Astro.url.searchParams.get('q'), first: 24 })` (Shopify's
[search syntax](https://shopify.dev/docs/api/usage/search-syntax): `tag:summer`, `vendor:Acme`, …).
Shopify searches the store's default language only. This needs SSR (`output: 'server'`, or
`export const prerender = false` on that page with an adapter): a static build has no `?q=` and
lists every product. On a static site use [search as you type](reference.md#search-as-you-type)
instead, and point the search form's `action` at a page that reads `q`.

**Prices are live:** a page built yesterday can show yesterday's price until the background refresh
(one request) replaces it; the cart and checkout always use Shopify's current price. Stores that
convert currencies see this often (exchange rates move). Rebuild regularly, or use SSR for pages
where it matters. Shopify can also round the cart price differently from the product price in some
markets (a cent or a euro): the cart is what's charged.

**Search as you type:** a `tether-search` form in your header ([markup](reference.md#search-as-you-type));
the starter has one.

## 4. Cart and View Transitions

Put the cart in your layout, outside `<slot />`:

```astro
---
import { ClientRouter } from 'astro:transitions';
---
<html>
  <head><ClientRouter /></head>
  <body>
    <header transition:persist>
      <button tether-cart-open>Cart (<span tether-cart-count>0</span>)</button>
    </header>
    <slot />
    <aside tether-cart-drawer transition:persist>
      <button tether-cart-close>Close</button>
      <div tether-cart-lines>
        <div><span tether-line="title"></span> × <span tether-line="quantity"></span></div>
      </div>
      <span tether-cart-subtotal></span>
      <button tether-checkout>Checkout</button>
    </aside>
  </body>
</html>
```

The drawer gets the class `is-open`: style it with `.drawer:global(.is-open)` in a component's
`<style>`, or with a global style. With `<ClientRouter />` Tether mounts each new page by itself and
closes the cart when the page changes (so a visitor who clicks a link in the cart sees the new page);
`transition:persist` keeps the drawer, its lines and the count as they are. `tether-checkout` gets
`is-disabled` while the cart is empty, and `tether-line="url"` links to the variant in the cart.
The full cart markup (quantity buttons, discount codes, notes) is in the
[reference](reference.md#cart); the starter's [`CartDrawer.astro`](https://github.com/ravi-klaassens/tether/tree/main/examples/astro/src/components/CartDrawer.astro) is a complete one.

Discount codes: `<form tether-discount-form><input tether-discount-input><button>Apply</button></form>`
(an invalid code gets `is-invalid` on the form and isn't kept), and `tether-cart-discounts` lists them.
Shopify's messages (stock, codes) come in the store's language for the visitor's `language`; when
the store doesn't have that language they're English. Translate them yourself with
`warningText: (w) => ({ MERCHANDISE_NOT_ENOUGH_STOCK: 'Niet meer op voorraad' })[w.code]` in
`window.TETHER_CONFIG` (functions can't go in `shop.config.js`). A line the warning is about gets
`is-warning`, and `tether-line="warning"` shows it next to that line.

When the visitor asks for more than is in stock, Shopify adds what it can and Tether shows
`tether-show="cart-warning"`, with Shopify's message in `[tether-cart-warning]`.

Put `transition:persist` on the header or on an island, not on both (an island inside a persisted
header is kept with it; Astro can't move a persisted element inside another one).

**Fonts:** load them with a `<link rel="stylesheet">` in the layout's `<head>` or Astro's Fonts API.
Font loaders that inject their styles with a script (Adobe Fonts' JavaScript kit, for example) lose
them on a `<ClientRouter />` navigation, because Astro replaces the `<head>`: use their CSS link instead.

## 5. React, Svelte, Vue islands

Tether's attributes work inside islands that are in the page when it loads; for ones rendered later,
call `Tether.mount(el)` (or set `observe: true`). For your own cart UI, read the cart from Tether
(more patterns, also for Next.js and SvelteKit: [other frameworks](frameworks.md)):

```jsx
import { useEffect, useState } from 'react';
import Tether from '@occluze/tether';

export function CartButton() {
  const [count, setCount] = useState(null);
  useEffect(() => Tether.cart.subscribe((cart, { count, loaded }) => setCount(loaded ? count : null)), []);
  return <button onClick={() => Tether.cart.open()}>Cart ({count ?? '…'})</button>;
}
```

`subscribe` calls you straight away, again when the saved cart has loaded, and after every change,
with `(cart, { count, open, loaded, warnings })`. `loaded` is false until Tether knows whether the
visitor has a saved cart: show a placeholder until then, not "0". The subtotal is
`cart.cost.subtotalAmount` (format it with `Tether.formatMoney()`).
It returns the unsubscribe function. Importing `@occluze/tether` in an island is SSR-safe and gives
the same instance the integration started (one cart). A mini cart:

```jsx
export function MiniCart() {
  const [lines, setLines] = useState([]);
  useEffect(() => Tether.cart.subscribe((cart) => setLines(cart?.lines.nodes || [])), []);
  return (
    <ul>
      {lines.map((l) => (
        <li key={l.id}>
          {l.merchandise.product.title} ({l.merchandise.title}) × {l.quantity}:
          {' '}{Tether.formatMoney(l.cost.totalAmount)}
          <button onClick={() => Tether.cart.removeLine(l.id)}>Remove</button>
        </li>
      ))}
    </ul>
  );
}
```

A cart line has `id`, `quantity`, `merchandise` (the variant: `id`, `title`, `image`, `price`,
`product.title`, `product.handle`), `cost` (`totalAmount`, `subtotalAmount`, `amountPerQuantity`,
`compareAtAmountPerQuantity`), `sellingPlanAllocation` (subscriptions) and `attributes`.
Line images are full size: `Tether.imageUrl(l.merchandise.image?.url, { width: 160 })` (in the
drawer markup: `<img tether-line="image" max-width="160" loading="lazy">`).
The types (`ShopifyCart`, `ShopifyCartLine`, `ShopifyProduct`) come from `@occluze/tether` and `@occluze/tether/server`.
Also there: `Tether.cart.add(variantId, quantity)` (or `add({ variantId, quantity, sellingPlanId })`, or a list of those),
`Tether.cart.updateLine(lineId, quantity)`, `Tether.cart.removeLine(lineId)`, `Tether.getProduct(handle)`, `Tether.on('variant-changed', fn)`
([JavaScript API](reference.md#javascript-api)).

## 6. Several markets

The build renders one market: the `country` / `locale` in `shop.config.js`. A visitor who picks
another one gets live prices for it in the browser (one batched request; the page shows the build
market's prices until then: hide them with
`html.tether-market-pending [tether-bind*="price"] { visibility: hidden }`). Their choice is
remembered, and the cart moves with it.

```astro
<select tether-country-select tether-countries="NL,DE"></select>  <!-- your markets, your order -->
```

```js
// shop.config.js: the money format per country
export default {
  country: 'NL', locale: 'nl-NL', productPath: '/shop',
  markets: { locales: { nl: { country: 'NL', locale: 'nl-NL' }, de: { country: 'DE', locale: 'de-DE' } } },
};
```

Or from your own UI: `Tether.setCountry('DE', { locale: 'de-DE' })`. Translations (`language`)
work too, and option names in your markup (`tether-option-list="Size"`) keep matching when Shopify
returns them translated. The checkout opens in the cart's language when the store has it.

**Pages per market** (for search engines in each language): a `createStorefront` per market and
`/de/…` routes, and on those pages:

```html
<meta name="tether-page-country" content="DE">
<meta name="tether-page-language" content="DE">
<meta name="tether-page-locale" content="de-DE">
```

That page is then always Germany, also after a View Transition from a Dutch page, and back. Note that
Shopify translates **handles** too (`the-h2-snowboard` → `das-h2-snowboard`): build `/de/` links
from the German products, and map languages by product `id` (for `hreflang` and your switcher).

## 7. Rebuild when products change

Prices and stock are live without a rebuild. A new product, a new title or new images need one.
The [sync Worker](../server/README.md) can start that build for you: deploy it with the Webflow
fields set to `none`, then add the secret `DEPLOY_HOOK_URL` with your host's deploy hook
(Cloudflare Pages: Settings → Builds → Deploy hooks; Netlify: Build hooks; Vercel: Deploy Hooks).

- Content changes (title, description, price, images, options, SEO) start a build. Stock changes don't.
- At most one build per minute (`DEPLOY_HOOK_MIN_SECONDS`), so a bulk edit gives one build.
- Using Webflow too? Keep the Webflow fields: it updates the CMS and starts the build.

## Check it

In the browser console: `await Tether.diagnose()`. It checks the token, the products on the page
and the markup, and tells you what to fix.

## Server API

`createStorefront(options)` from `@occluze/tether/server` (Node, Workers, Deno; no browser needed):

| Method | Returns |
|---|---|
| `getProduct(handleOrId)` | a product, or `null`. Accepts a handle, numeric id, gid or product URL |
| `getProducts({ first, after, query, collection, sortKey, reverse })` | `{ products, pageInfo, collection }` |
| `allProducts({ query, collection })` | every product, page by page (for `getStaticPaths`) |
| `getCollection(handle, { first, sortKey, … })` | the collection with `products` and `pageInfo`, or `null` |
| `allCollections()` | every collection (`handle`, `title`, `description`, `image`, `seo`) |
| `getRecommendations(handleOrId)` | related products |
| `initialState(product, { variant })` | what Tether shows first: `variant`, `selected`, `price`, `compareAtPrice`, `available`, `purchase`, `plan`, `plans`, `savings`, `show`, `isUnavailable()` |
| `hydrate(products, { card, images })` | the `<script>` tag for the browser (see above); cards keep 2 images by default |
| `jsonLd(product, { url })`, `jsonLdData(product)` | schema.org Product / ProductGroup for search engines |
| `formatMoney(money)`, `formatPercent(n)`, `imageUrl(url, { width })` | strings, same rules as the browser |
| `productUrl(handle)` | the product's link from `productPath`, or `null` for an empty handle |
| `query(graphql, variables)` | any Storefront API query, in the configured market |

A product is the Storefront API product, the same shape the browser uses: `title`, `handle`,
`descriptionHtml`, `featuredImage`, `images.nodes`, `options[].optionValues[].name`,
`variants.nodes` (`id`, `price`, `availableForSale`, `selectedOptions`), `priceRange`,
`sellingPlanGroups.nodes`, `seo`, `metafields`. Full types: `ShopifyProduct` in the included
TypeScript definitions (your editor shows them).
`descriptionHtml` is the HTML as written in Shopify, by anyone who can edit products, including apps.
Never put it in the page with `set:html` as it is: it can carry script that runs on your shop's
domain. In the browser, `tether-bind="description"` cleans it through an allow-list. Tether has no
cleaner for the build, because Node has no DOM, so the starter renders the plain-text `description`
in that element and lets the script swap in the cleaned HTML:

```astro
<div tether-bind="description">{product.description}</div>
```

To render the HTML at build time instead, sanitize it first with a maintained library such as
[sanitize-html](https://www.npmjs.com/package/sanitize-html), with an allow-list of tags and
attributes, and only then use `set:html`.
