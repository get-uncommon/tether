- Fix: loading the cart again (after another tab changed it, or `Tether.cart.init()`) waits for the
  changes in flight in this tab, so an older answer can't replace the cart they left.
