- Fix: With `analytics.shopify` on an Astro site with the ClientRouter, the landing page sends
  Shopify one `page_viewed` instead of two: Astro's `astro:page-load` for the page Tether started on
  no longer counts as a second view. Client-side navigations still each send one.
