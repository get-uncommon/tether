- Docs (sync Worker): the costs table says customer-account logins, token refreshes and logouts
  share KV's 1,000 daily writes with the sync, and that logins fail once they run out; the reconcile
  saves the cursor of the last product it did, not a page and offset; and a repeated
  `products/delete` with `onDelete: 'delete'` can cost one KV write when the cached item index still
  lists the deleted item.
