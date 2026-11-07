- Fix: A `url:` list whose parameter is only spaces (`?q=+`) is an empty search, so with
  `emptyQuery: 'none'` (or `tether-empty-query="none"`) it lists nothing instead of every product,
  and a search is sent without the spaces around it.
