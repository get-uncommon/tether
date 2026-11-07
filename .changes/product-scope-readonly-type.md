- **Breaking (types):** the `ProductScope` type, which `Tether.getScope()` and the `product-ready`
  and `product-updated` events give, has read-only fields (`purchase`, `selected`, `variant`,
  `quantity`, `product`, `plans`), as documented. **Upgrade:** code that assigned one calls the
  scope's method instead (`select`, `selectVariant`, `setPurchase`, `selectPlan`, `setQuantity`).
  Nothing changes at runtime.
