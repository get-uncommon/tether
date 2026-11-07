- Fix: With Barba's `sync: true`, which runs `beforeEnter` before `afterLeave`, page transitions
  send Shopify their `page_viewed`; before, none did. A container mounted outside the page shown is
  the new page once `Tether.unmount()` runs, before or after the mount, and its product sends
  `product_viewed` while the page left is still in the document. The docs and the Barba preset
  unmount in `beforeLeave`, which runs first in both modes, and the docs show Swup's hooks. A list
  that renders after `Tether.unmount()` no longer starts the next page's view before that page
  mounts.
