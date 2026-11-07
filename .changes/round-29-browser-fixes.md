- Fix: With a `storageKey` of the site's own, a cart change in another tab of the site reaches this
  tab again: the storage listener follows the keys the cart and the market are stored under, not
  every key that starts with the prefix. `localStorage.clear()` in another tab loads the cart again.
- Fix: With `analytics.shopify`, an Astro navigation made before the analytics part loaded sends a
  `page_viewed` for each page, and the product page left sends its `product_viewed`. Before, the
  page the visitor left counted for none.
- Fix: With page transitions (Barba, Swup, the Barba preset), the container
  `Tether.mount(container)` mounts after `Tether.unmount()` sends Shopify a `page_viewed`, so each
  page counts, not only the first. Astro's navigations still send one each.
- Fix: Search results that arrive after the visitor pressed Escape, clicked outside or left the
  search box stay closed (`aria-expanded="false"`) until the box has focus again.
- Fix: Clicking Edit on another address while an address is saving keeps that address in the form,
  so Save changes it instead of creating a new one.
- Fix: A failed address delete or make-default shows Shopify's message in the address form's
  `tether-form-error` when the address row has none, as in the documented markup, with
  `role="alert"`.
- Fix: `[tether-cart-warning]` gets `role="status"` when it has no role of its own, so screen
  readers announce Shopify's warning. It looks the same.
