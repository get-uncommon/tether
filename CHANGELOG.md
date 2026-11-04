# Changelog

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
