# Customer accounts

Login, the customer's name and orders, and a checkout that knows them (saved addresses and cards),
with Shopify's [Customer Account API](https://shopify.dev/docs/api/customer). The account part
(4 KB) loads only on pages that use it.

There are two ways to run it. **Use the server mode for live sites.**

| | Server mode (recommended) | Browser mode |
|---|---|---|
| Where the login lives | your [sync Worker](../server/README.md), encrypted | the visitor's browser |
| What the browser holds | a session cookie scripts can't read | the Shopify tokens |
| A malicious script on your site | can't take the login away; while the page is open it can act as the customer there | could take the tokens and use them anywhere |
| Setup | the Worker on your shop's domain (a route) | nothing extra |

Either way, there's no Tether server: the data goes between the visitor, Shopify and your own
Worker.

## Server mode

The Worker does the login with Shopify (OAuth with PKCE, the id token's signature checked against
Shopify's keys), keeps the tokens **encrypted** in its KV storage (AES-GCM, under a hash of the
session id, bound to its key), and gives the browser one cookie: `__Host-tether-account`, `HttpOnly`,
`Secure`, `SameSite=Lax`. The browser can only ask for the profile and the orders, link its cart,
and log out; only from your site's address, and changes need a header other sites can't send.

- **Login CSRF:** the pending login is sealed in a cookie in the browser that started it, so
  nobody can log a visitor into someone else's account by sending them a login link.
- **Nothing is stored before a real login**, so anonymous login requests can't fill your KV quota.
- **Logout always works:** the session is ended and the cookie cleared first, even when Shopify is
  slow or down. The id token for Shopify's logout goes through a one-time HttpOnly cookie, never
  through the page.
- **Sessions end:** after `ACCOUNT_SESSION_DAYS` (14) from login, however much they're used, and
  as soon as Shopify ends them.
- **What it can't stop:** a malicious script running on your own page can still act as the
  customer while that page is open (read their profile and orders, link carts). Keep third-party
  scripts off account pages, and use a Content-Security-Policy.

### 1. Shopify

1. Settings → Customer accounts → choose **Customer accounts** (the new ones).
2. Sales channels → **Headless** → your storefront → **Customer Account API**:
   - Client type: **Confidential** (best: the Worker keeps the client secret) or Public.
   - Callback URI: `https://your-shop.com/_tether/account/callback`
   - JavaScript origin: `https://your-shop.com`
   - Logout URI: `https://your-shop.com/`
3. Copy the **Client ID** (and the secret for a Confidential client).

### 2. The Worker on your shop's domain

Browsers only send the login cookie to your own domain, so the Worker has to answer there:
Cloudflare → Workers & Pages → **tether-sync** → Settings → **Domains & Routes** → Add →
**Route** `your-shop.com/_tether/*` (your domain's DNS must be on Cloudflare; free). Or a custom
domain such as `account.your-shop.com`.

Then the Worker's secrets (Settings → Variables and Secrets):

| Secret | Value |
|---|---|
| `ACCOUNT_CLIENT_ID` | the Client ID |
| `ACCOUNT_CLIENT_SECRET` | the client secret (Confidential client only) |
| `ACCOUNT_ORIGINS` | your site, e.g. `https://your-shop.com` (more with commas) |
| `STOREFRONT_TOKEN` | the public Storefront token (to link carts, so checkout knows the customer) |
| `ACCOUNT_SESSION_DAYS` | optional, how long a login lasts at most (default 14) |
| `ACCOUNT_SECRET` | optional, 24+ characters: the encryption key for sessions, instead of deriving it from `SYNC_SECRET` |

`SHOPIFY_DOMAIN` and `SYNC_SECRET` are already set; the encryption keys are derived from
`SYNC_SECRET` (or `ACCOUNT_SECRET`). The Worker's `/check` (e.g. `https://tether-sync.your-name.workers.dev/check`) says
whether accounts are set up, whether the Worker answers on your domain, and which URLs to register
in Shopify.

### 3. Your site

```js
window.TETHER_CONFIG = {
  …,
  account: { server: '/_tether/account' },   // or the full URL: 'https://your-shop.com/_tether/account'
};
```

The markup and JavaScript below are the same in both modes.

## Browser mode

For a quick start or a site without its own domain on Cloudflare. The login happens in the
browser (OAuth with PKCE; `state`, `nonce`, issuer and audience checked); the tokens live in
`sessionStorage` (gone when the tab closes), or `localStorage` with `remember: true`. As on any
site where the browser holds a login, a malicious script on your pages could read them: keep
third-party scripts off account pages, and use a Content-Security-Policy. `Tether.diagnose()` warns
when a live site uses this mode.

1. Shopify: as above, client type **Public**, and the callback URI is the page visitors come back
   to (e.g. `https://your-shop.com/account`).
2. Your site: `account: { clientId: '…', callbackUrl: 'https://your-shop.com/account', logoutUrl: 'https://your-shop.com/' }`.

Shopify only allows `https` addresses, no `localhost`: test on a staging domain or a tunnel.

## Markup

```html
<button tether-account-login tether-show="logged-out">Log in</button>
<div tether-show="logged-in">
  Hi <span tether-account-bind="first-name"></span>
  <button tether-account-logout>Log out</button>
  <a tether-account-link>Subscriptions and addresses</a>   <!-- Shopify's account pages -->
</div>

<div tether-orders tether-limit="10">                      <!-- first child is the template -->
  <a tether-order-bind="url">
    <img tether-order-bind="image" alt="">
    <span tether-order-bind="name"></span> · <span tether-order-bind="date"></span> ·
    <span tether-order-bind="total"></span> · <span tether-order-bind="status"></span>
    <div tether-order-lines>                               <!-- each product of the order -->
      <div><img tether-order-line="image" alt=""> <span tether-order-line="quantity"></span>×
        <span tether-order-line="title"></span> <span tether-order-line="variant-title"></span></div>
    </div>
  </a>
</div>
<p tether-show="orders-loading">Loading your orders…</p>
<p tether-show="orders-empty" hidden>No orders yet.</p>
```

`tether-account-bind`: `first-name`, `last-name`, `name`, `email`, `address`.
`tether-order-bind`: `name` (#1001), `date`, `total`, `status` (payment), `fulfillment`, `items`,
`image` (the first product's image), `url` (Shopify's order status page). `tether-order-line`:
`title`, `variant-title`, `quantity`, `image`.

While logged in, checkout knows the customer (their details filled in, the order in their account).
Logging out unlinks the cart. **Subscriptions** (skip, pause, cancel) are managed on Shopify's
account pages, through your subscription app: `tether-account-link` goes there.

## JavaScript

```js
await Tether.account.login();                 // to Shopify's login page and back
const me = await Tether.account.customer();   // { firstName, lastName, emailAddress, … }
const orders = await Tether.account.orders({ first: 5 });
await Tether.account.logout();
```

Browser mode also has `Tether.account.query(gql, variables)` for any Customer Account API query;
server mode answers only the profile and the orders, on purpose. Events: `tether:account-login`,
`tether:account-logout`, `tether:account-error`.

## Tested

Both modes on a real store: login, the customer and orders, a checkout that opens logged in, and
logout. In server mode the browser held no Shopify token at any point (no cookie scripts can read,
nothing in its storage). Server mode's unit tests also cover the whole flow against a simulated
Shopify, including the attacks it must refuse: login CSRF, a replayed or expired login, a tampered
or wrongly signed id token, another site's origin, a cross-site form, a return address on another
site, sessions moved between KV keys, logout during a Shopify outage, and two requests refreshing
at once. An independent security review found nothing critical; its findings are fixed and tested.
