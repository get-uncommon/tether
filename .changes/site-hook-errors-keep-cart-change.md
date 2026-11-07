- Fix: a `warningText` or `formatMoney` that throws is reported (`onError`) and no longer fails a
  cart change Shopify already applied: the change resolves, its cart (a new one included) is kept,
  and the page shows Shopify's warning text or Tether's own money format instead.
