- Fix: With `analytics.shopify`, `Tether.mount(el)` for a part of the page (products added later, an
  island, your own component) is no longer taken for a new page: a product mounted later on a
  product page sends no second `product_viewed`, and an island mounted outside `<main>` no longer
  makes the next `Tether.unmount()` send the page view early, with the old page's URL.
