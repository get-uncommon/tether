- Lists: a `tether-products="url:q"` list on a page without a `?q=`, or with an empty one, can list
  nothing instead of every product: `emptyQuery: 'none'` in the config, or
  `tether-empty-query="none"` on the list (which overrides the config, also with `"all"`), shows its
  `list-empty` state and asks Shopify nothing. The default stays `'all'`. An unknown value warns,
  and falls back to `'all'` in the config and to the config's value on a list.
