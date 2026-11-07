- Fix: an open cart drawer the site takes off the page (a page swap without `Tether.unmount()`, a
  re-render) is announced closed: `aria-expanded` on `tether-cart-open`, `onCartClose`,
  `tether:cart-toggled` and `subscribe` say so, and a `manual` drawer the site opens afterwards is
  usable instead of staying `inert` and `aria-hidden`.
