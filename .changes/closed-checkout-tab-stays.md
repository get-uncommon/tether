- Fix: with `checkoutTarget: '_blank'`, a visitor who closes the new tab before the checkout URL has
  come stays on the page, instead of this page going to checkout; `checkout()` answers `null`.
