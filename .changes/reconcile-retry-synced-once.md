- Fix (sync Worker): a product on the retry list that is also in the reconcile's window is synced
  once per run instead of twice, and a product that keeps failing is given up after its five
  attempts instead of staying on the retry list.
