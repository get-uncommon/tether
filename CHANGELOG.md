# Changelog

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
