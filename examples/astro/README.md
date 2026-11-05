# Tether + Astro starter

A Shopify store in Astro: product pages built from Shopify at build time (real HTML for search
engines), with live prices, stock, variants, subscriptions and a cart through
[Tether](https://github.com/ravi-klaassens/tether).

```bash
npm create astro@latest -- --template ravi-klaassens/tether/examples/astro my-shop
cd my-shop
npm install             # if the wizard didn't
cp .env.example .env    # Shopify's public demo store; put your store and Storefront token here
npm run dev
```

- `src/shop.config.js`: market and product URLs, shared by the browser and the build.
- `astro.config.mjs`: the Tether integration (adds the script to every page).
- `src/lib/shop.js`: `createStorefront()` for build-time data.
- `src/pages/products/[handle].astro`: one page per product. `shop.initialState(product)` renders
  what Tether shows first (no flash), `shop.hydrate(product)` saves the browser a request.
- `src/components/CartDrawer.astro`: the cart, kept across View Transitions.
- `src/pages/search.astro`: search results on a static site (`tether-products="url:q"`).
- Set `site` in `astro.config.mjs` (or `SITE_URL`) to your domain: structured data and canonical
  links use it. Commit `package-lock.json` for reproducible builds.

Guide: [Tether with Astro](https://github.com/ravi-klaassens/tether/blob/main/docs/astro.md),
including [rebuilding when products change](https://github.com/ravi-klaassens/tether/blob/main/docs/astro.md#7-rebuild-when-products-change).
