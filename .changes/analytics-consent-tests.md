- Repository: the browser test of Shopify's analytics asserts that nothing is sent before the
  visitor's consent and that events go out after it, and a unit test covers the analytics bus's
  consent gating, buffer and replay for each consent state.
