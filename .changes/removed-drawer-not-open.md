- Fix: a cart drawer the site closed itself and then took off the page no longer leaves the cart
  marked open (`Tether.cart.isOpen()`, `subscribe`), so the next `open()` is announced.
