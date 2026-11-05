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
  <a tether-account-link>Your Shopify account</a>   <!-- or ="subscriptions" / "payment" -->
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
Logging out unlinks the cart.

## On your own site: order pages, profile, addresses, subscriptions, returns

Everything the Customer Account API allows runs on your pages (their own part, 6 KB, loaded only
where these attributes are). Only what has to stay with Shopify does: the login itself, checkout
and payment, and changing a saved card.

```js
account: {
  server: '/_tether/account',
  orderUrl: '/account/order?id={id}',   // tether-order-bind="url" links to your order page (default: Shopify's)
  subscriptionsUrl: 'https://shopify.com/…/account/pages/…', // Shopify Subscriptions → Settings → Subscription management URL
}
```

**Order page** (`/account/order?id=1234`):

```html
<section tether-order="url:id">                        <!-- or tether-order="gid://shopify/Order/…" -->
  <p tether-order-show="loading">Loading…</p>
  <p tether-order-show="not-found" hidden>Order not found.</p>
  <h1 tether-order-bind="name"></h1> <span tether-order-bind="date"></span>
  <span tether-order-bind="status"></span> · <span tether-order-bind="fulfillment"></span>
  <div tether-order-lines>
    <div>
      <img tether-order-line="image" alt=""> <span tether-order-line="title"></span>
      <span tether-order-line="variant-title"></span> × <span tether-order-line="quantity"></span>
      <span tether-order-line="total"></span>
      <span tether-order-line-show="returnable">                 <!-- only lines that can be returned -->
        <input tether-return-quantity type="number"> <select tether-return-reason></select>
        <input tether-return-note placeholder="Note (optional)">
      </span>
    </div>
  </div>
  <p>Subtotal <span tether-order-bind="subtotal"></span> · Shipping <span tether-order-bind="shipping"></span>
     · Tax <span tether-order-bind="tax"></span> · Total <span tether-order-bind="total"></span></p>
  <p tether-order-bind="shipping-address"></p>
  <div tether-order-fulfillments>
    <p><span tether-fulfillment-bind="status"></span> <span tether-fulfillment-bind="company"></span>
       <a tether-fulfillment-bind="url"><span tether-fulfillment-bind="number"></span></a></p>
  </div>
  <button tether-order-return tether-order-show="returnable" tether-confirm="Request this return?">Request a return</button>
  <p tether-order-show="return-requested" hidden>Return requested. We'll email you.</p>
  <p tether-form-error></p>
</section>
```

- `tether-order-bind`: `name`, `date`, `total`, `subtotal`, `shipping`, `tax`, `status`, `fulfillment`,
  `shipping-address`, `billing-address`, `items`, `cancelled`, `url` (Shopify's status page).
- `tether-order-line`: `title`, `variant-title`, `quantity`, `price`, `total`, `sku`, `image`, `returnable`.
- `tether-fulfillment-bind`: `status`, `date`, `eta`, `company`, `number`, `url` (tracking link).
- `tether-order-show`: `loading`, `ready`, `not-found`, `error`, `shipped`, `cancelled`, `returnable`,
  `has-returns`, `return-requested`. The order root gets `tether-order-state`.
- **Returns:** the quantities typed in `tether-return-quantity` (at most what Shopify says is
  returnable), with the reason from `tether-return-reason` (Shopify's suggested reasons), go to
  Shopify as a return request. You approve it in the Shopify admin, as usual.

**Profile and addresses:**

```html
<form tether-profile-form>
  <input name="firstName"> <input name="lastName"> <button>Save</button>
  <p tether-form-error></p>
</form>

<ul tether-addresses>
  <li>
    <span tether-address-bind="formatted"></span> <b tether-address-show="default">Default</b>
    <button tether-address-edit>Edit</button>
    <button tether-address-default tether-address-show="not-default">Make default</button>
    <button tether-address-delete tether-confirm="Delete this address?">Delete</button>
  </li>
</ul>
<p tether-show="addresses-empty" hidden>No addresses yet.</p>

<form tether-address-form>                            <!-- new, or the one you clicked Edit on -->
  <input name="firstName"> <input name="lastName"> <input name="address1"> <input name="address2">
  <input name="zip"> <input name="city"> <input name="countryCode" placeholder="NL"> <input name="phoneNumber">
  <label><input type="checkbox" name="isDefault"> Default address</label>
  <button>Save</button> <button type="reset" tether-address-new>New</button>
  <p tether-form-error></p>
</form>
```

`tether-address-bind`: `formatted`, `name`, `company`, `address1`, `address2`, `city`, `zip`,
`province`, `country`, `phone`. Forms get `tether-form-state="pending|saved|error"`, and Shopify's
message (e.g. "Zip is invalid") goes in `tether-form-error`.

**Subscriptions** (Shopify Subscriptions or any app that uses Shopify's subscription contracts):

```html
<p tether-show="subscriptions-loading">Loading…</p>
<p tether-show="subscriptions-empty" hidden>No subscriptions.</p>
<div tether-subscriptions>
  <article>
    <div tether-subscription-lines><p><span tether-subscription-line="quantity"></span>×
      <span tether-subscription-line="title"></span> <span tether-subscription-line="price"></span></p></div>
    <p>Every <span tether-subscription-bind="interval"></span> · next <span tether-subscription-bind="next"></span>
       · <span tether-subscription-bind="status"></span></p>
    <p tether-subscription-show="skipped" hidden>The next delivery is skipped.</p>
    <button tether-subscription-action="skip">Skip next</button>
    <button tether-subscription-action="unskip">Undo skip</button>
    <button tether-subscription-action="pause">Pause</button>
    <button tether-subscription-action="resume">Resume</button>
    <button tether-subscription-action="cancel" tether-confirm="Cancel this subscription?">Cancel</button>
    <p tether-form-error></p>
  </article>
</div>
<a tether-account-link="payment">Change payment method</a>   <!-- Shopify's secure page -->
```

- `tether-subscription-bind`: `status`, `next` (next billing date), `interval` (month, 2 months, …),
  `products`, `total`, `delivery`. `tether-subscription-line`: `title`, `variant-title`, `quantity`,
  `price`, `image`.
- `tether-subscription-show`: `active`, `paused`, `cancelled`, `expired`, `failed`, `skipped`,
  `can-pause`, `can-resume`, `can-skip`, `can-unskip`, `can-cancel`. Actions that don't apply get
  `disabled` and `is-disabled`; while one runs the row has `is-busy` and
  `tether-subscription-state="pending"` (then `done` or `error`).
- **Payment method:** card details never touch your site. `tether-account-link="payment"` (or
  `"subscriptions"`) goes to Shopify's page for it (`paymentUrl`, default `subscriptionsUrl`).

**Security (server mode):** each of these is one fixed operation in the Worker, with no query
passthrough. Ids are checked for their type, address fields are limited to Shopify's address
fields with bounded lengths, and a subscription is looked up through the logged-in customer before
any action, so a customer can only act on their own orders, addresses and subscriptions (Shopify
enforces the same through the customer's token). Every change needs the allowed origin and the
`X-Tether-Account` header, like the routes above. Browser mode runs the same documents and checks.

## JavaScript

```js
await Tether.account.login();                 // to Shopify's login page and back
const me = await Tether.account.customer();   // { firstName, lastName, emailAddress, … }
const orders = await Tether.account.orders({ first: 5 });
const order = await Tether.account.order(1234);          // lines, totals, fulfillments, returnable lines
await Tether.account.updateProfile({ firstName: 'Ada' });
const list = await Tether.account.addresses();           // [{ id, formatted, isDefault, … }]
await Tether.account.saveAddress({ address1: 'Main St 1', zip: '1011 AB', city: 'Amsterdam', countryCode: 'NL' }, { isDefault: true });
await Tether.account.deleteAddress(list[1].id);
const subs = await Tether.account.subscriptions();
await Tether.account.subscriptionAction(subs[0].id, 'skip');  // pause | resume | skip | unskip | cancel
await Tether.account.requestReturn(order.id, [{ lineItemId: order.lineItems.nodes[0].id, quantity: 1 }]);
await Tether.account.logout();
```

Errors are `TetherError`s; Shopify's validation messages are in `err.userErrors`. Browser mode also
has `Tether.account.query(gql, variables)` for any Customer Account API query; server mode answers
only these fixed operations, on purpose. Events: `tether:account-login`, `tether:account-logout`,
`tether:account-updated` (`detail.what`: profile, addresses, subscriptions, orders),
`tether:account-error`.

## Tested

Both modes on a real store: login, the customer and orders, a checkout that opens logged in, and
logout. In server mode the browser held no Shopify token at any point (no cookie scripts can read,
nothing in its storage). Server mode's unit tests also cover the whole flow against a simulated
Shopify, including the attacks it must refuse: login CSRF, a replayed or expired login, a tampered
or wrongly signed id token, another site's origin, a cross-site form, a return address on another
site, sessions moved between KV keys, logout during a Shopify outage, and two requests refreshing
at once. An independent security review found nothing critical; its findings are fixed and tested.
