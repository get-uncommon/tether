# Customer accounts

Login, the customer's name and orders, and a checkout that knows them (saved addresses and cards),
with Shopify's [Customer Account API](https://shopify.dev/docs/api/customer). The account part
(3.5 KB) loads only on pages that use it.

**Your data stays between the visitor and Shopify.** Login happens on Shopify's own page; the token
lives in the visitor's browser; Tether talks to Shopify directly. There's no Tether server.

## 1. Shopify (once)

1. Settings → Customer accounts → choose **Customer accounts** (the new ones).
2. Sales channels → **Headless** → your storefront → **Customer Account API** settings:
   - Client type: **Public** (Web).
   - Callback URI: the page visitors come back to after login, e.g. `https://your-site.com/account`.
   - JavaScript origin: `https://your-site.com` (no path).
   - Logout URI: e.g. `https://your-site.com/`.
3. Copy the **Client ID**.

Shopify only allows `https` addresses, no `localhost`: test on your staging domain, or with a tunnel
(Cloudflare Tunnel, ngrok) registered the same way.

## 2. Your site

```js
window.TETHER_CONFIG = {
  …,
  account: {
    clientId: 'your-client-id',
    callbackUrl: 'https://your-site.com/account',   // default: the page the visitor logs in from
    logoutUrl: 'https://your-site.com/',
    // remember: true,                                // stay logged in across tabs and restarts
  },
};
```

```html
<button tether-account-login tether-show="logged-out">Log in</button>
<div tether-show="logged-in">
  Hi <span tether-account-bind="first-name"></span>
  <button tether-account-logout>Log out</button>
  <a tether-account-link>Subscriptions and addresses</a>   <!-- Shopify's account pages -->
</div>

<div tether-orders tether-limit="10">                      <!-- first child is the template -->
  <a tether-order-bind="url">
    <span tether-order-bind="name"></span> · <span tether-order-bind="date"></span> ·
    <span tether-order-bind="total"></span> · <span tether-order-bind="status"></span>
  </a>
</div>
```

`tether-account-bind`: `first-name`, `last-name`, `name`, `email`, `address`.
`tether-order-bind`: `name` (#1001), `date`, `total`, `status` (payment), `fulfillment`, `items`,
`url` (Shopify's order status page).

While logged in, the cart carries the customer, so checkout fills in their details and the order
shows up in their account. Logging out unlinks the cart.

**Subscriptions** (skip, pause, cancel) are managed on Shopify's account pages, through your
subscription app: `tether-account-link` goes there.

## JavaScript

```js
await Tether.account.login();                 // to Shopify's login page and back
const me = await Tether.account.customer();   // { firstName, lastName, emailAddress, … }
const orders = await Tether.account.orders({ first: 5 });
const data = await Tether.account.query(`{ customer { addresses(first: 5) { nodes { formatted } } } }`);
await Tether.account.logout();
```

Events: `tether:account-login`, `tether:account-logout`, `tether:account-error`.

## Security

- Login uses OAuth with PKCE; Tether checks `state` and the id token's `nonce`, issuer and audience.
- Tokens are kept in `sessionStorage` (gone when the tab closes), or `localStorage` with
  `remember: true`. As on any site where the browser holds a login, don't load untrusted scripts on
  your pages (a strict Content-Security-Policy helps).
- Tested on a real store: login, the token exchange and refresh straight from the browser, the
  customer and orders queries, the cart linked to the customer (checkout opens logged in), and
  logout (cart unlinked, tokens removed).
- If your setup can't reach Shopify's token endpoint (a CORS error at login), set
  `account.tokenUrl` to a small endpoint on your own server that forwards the form body to
  Shopify's token endpoint.
