- Fix: when loading the cart again for a change in another tab fails, this tab keeps the cart it had
  instead of showing it empty, so the count and the drawer stay, and the next `setAttributes`,
  `applyDiscount` or `removeDiscount` keeps the cart's other attributes and discount codes instead
  of replacing them.
