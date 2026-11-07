- Fix: a product asked for again after `clearProductCache()` or a country switch, while its first
  request was queued or on its way, no longer leaves the first caller waiting forever, which could
  keep `html.tether-market-pending` on the page; each caller gets the product.
