- Fix: `Tether.cart.add(v); Tether.cart.checkout()` on a page with no cart yet, or an empty one,
  checks out the added line instead of doing nothing.
