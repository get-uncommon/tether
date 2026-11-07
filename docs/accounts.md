# Customer accounts

Login, the customer's name and orders, and a checkout that knows them (saved addresses and cards),
with Shopify's [Customer Account API](https://shopify.dev/docs/api/customer). The account part
(about 4 KB gzipped) loads only on pages that need it: pages with account markup, a login coming
back (the Worker's `?account=`), and pages where the visitor may be logged in.

Accounts run through your own [sync Worker](../server/README.md). A customer token gives full access
to that customer's account, and any script on a page can read what the page stores, so the token
stays in the Worker and the browser holds only a cookie its scripts can't read.

There's no Tether server: the data goes between the visitor, Shopify and your own Worker.

## How it works

The Worker does the login with Shopify (OAuth with PKCE, the id token's signature checked against
Shopify's keys), keeps the tokens **encrypted** in its KV storage (AES-GCM, under a hash of the
session id, bound to its key), and gives the browser one cookie: `__Host-tether-account`, `HttpOnly`,
`Secure`, `SameSite=Lax`. The browser can only ask for the profile and the orders, run the fixed
[account operations](#on-your-own-site-order-pages-profile-addresses-subscriptions-returns), link its
cart, and log out; only from your site's address, and changes need a header other sites can't send.

- **Login CSRF:** the pending login is sealed in a cookie in the browser that started it, so
  nobody can log a visitor into someone else's account by sending them a login link.
- **Nothing is stored before a real login**, so anonymous login requests can't fill your KV quota.
- **Logout always works:** the session is ended and the cookie cleared first, even when Shopify is
  slow or down. The id token for Shopify's logout goes through a one-time HttpOnly cookie, never
  through the page.
- **Sessions end:** after `ACCOUNT_SESSION_DAYS` (14) from login, however much they're used, and
  as soon as Shopify ends them.
- **What it can't stop:** a malicious script running on your own page can still act as the
  customer while that page is open (read their profile and orders, link carts), but it can't take
  the login away. Keep third-party scripts off account pages, and use a Content-Security-Policy.

## Setup

First pick where the Worker answers, because the callback URI and `account.server` follow from
it. Browsers only send the login cookie to your own domain, so it has to be your shop's domain or
a subdomain of it, and the Worker builds its callback from the host it answers on:

| Setup                                                                     | Callback URI (step 1)                                    | `account.server` (step 3)                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| **Recommended:** a route on your shop's domain, `your-shop.com/_tether/*` | `https://your-shop.com/_tether/account/callback`         | `'/_tether/account'`                              |
| The Worker's own custom domain, e.g. `account.your-shop.com`              | `https://account.your-shop.com/_tether/account/callback` | `'https://account.your-shop.com/_tether/account'` |

The JavaScript origin and the logout URI are your site in both setups: after logging out, Shopify
sends the customer back to the page they were on.

### 1. Shopify

1. Settings → Customer accounts → choose **Customer accounts** (the new ones).
2. Sales channels → **Headless** → your storefront → **Customer Account API**:
   - Client type: **Confidential** (best: the Worker keeps the client secret) or Public.
   - Callback URI: `https://your-shop.com/_tether/account/callback`, or with a custom domain
     `https://account.your-shop.com/_tether/account/callback` (the table above)
   - JavaScript origin: `https://your-shop.com`
   - Logout URI: `https://your-shop.com/`
3. Copy the **Client ID** (and the secret for a Confidential client).

### 2. The Worker on your shop's domain

Cloudflare → Workers & Pages → **tether-sync** → Settings → **Domains & Routes** → Add →
**Route** `your-shop.com/_tether/*` (your domain's DNS must be on Cloudflare; free). With a custom
domain instead, Add → **Custom domain** `account.your-shop.com`, and register its callback URI in
step 1.

Then the Worker's secrets (Settings → Variables and Secrets):

| Secret                  | Value                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACCOUNT_CLIENT_ID`     | the Client ID                                                                                                                                                                                                                                                |
| `ACCOUNT_CLIENT_SECRET` | the client secret (Confidential client only)                                                                                                                                                                                                                 |
| `ACCOUNT_ORIGINS`       | your site, e.g. `https://your-shop.com` (more with commas)                                                                                                                                                                                                   |
| `STOREFRONT_TOKEN`      | the public Storefront token (to link carts, so checkout knows the customer)                                                                                                                                                                                  |
| `ACCOUNT_SECRET`        | required, 24+ random characters (`openssl rand -hex 24`), not the same as `SYNC_SECRET`: the sessions' encryption keys come from it. Without it, or with the value of `SYNC_SECRET`, the account routes answer 503. Changing it logs every customer out once |
| `ACCOUNT_SESSION_DAYS`  | optional, how long a login lasts at most (default 14)                                                                                                                                                                                                        |

`SHOPIFY_DOMAIN` is already set. The Worker's `/check` (e.g. `https://tether-sync.your-name.workers.dev/check`,
with `Authorization: Bearer YOUR_SYNC_SECRET`) says whether accounts are set up, what is missing,
whether the Worker answers on your domain, and which URLs to register in Shopify.

### 3. Your site

```js
window.TETHER_CONFIG = {
  …,
  account: { server: '/_tether/account' },   // a route on your shop's domain
  // account: { server: 'https://account.your-shop.com/_tether/account' },   // the Worker's own custom domain
};
```

Without `server` accounts are off, and the console says so.

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
`tether-limit` is how many orders the list shows: 10 by default, at most 50.

While logged in, checkout knows the customer (their details filled in, the order in their account).
Logging out unlinks the cart.

## On your own site: order pages, profile, addresses, subscriptions, returns

Everything the Customer Account API allows runs on your pages (their own part, about 6 KB gzipped, loaded only
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
- `tether-fulfillment-bind`: `status`, `date`, `eta`, `company`, `number`, `url` (tracking link; hidden
  when the shipment has none).
- `tether-order-show`: `loading`, `ready`, `not-found`, `error`, `shipped`, `cancelled`, `returnable`,
  `has-returns` (an earlier return), `return-requested` (just sent here; `has-returns` then stays
  hidden). The order root gets `tether-order-state`.
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
<p tether-show="addresses-error" hidden>Your addresses couldn't be loaded.</p>

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
<p tether-show="subscriptions-error" hidden>Your subscriptions couldn't be loaded.</p>
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

**Security:** each of these is one fixed operation in the Worker, with no query
passthrough. Ids are checked for their type, address fields are limited to Shopify's address
fields with bounded lengths, and a subscription is looked up through the logged-in customer before
any action, so a customer can only act on their own orders, addresses and subscriptions (Shopify
enforces the same through the customer's token). Every change needs the allowed origin and the
`X-Tether-Account` header, like the routes above.

## JavaScript

```js
await Tether.account.login();                 // to Shopify's login page and back
const me = await Tether.account.customer();   // { firstName, lastName, emailAddress, … }
const orders = await Tether.account.orders({ first: 5 });   // 1 to 50, default 10
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

Logged out, `customer()` answers `null` and `orders()` `[]`. There is no query passthrough: the
Worker answers only these fixed operations, on purpose.

### Errors

Failures are `TetherError`s with a `code`:

| `code`           | When                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOT_LOGGED_IN`  | an action that needs a customer (order, profile, addresses, subscriptions, returns) while nobody is logged in                                                                                                   |
| `INVALID`        | Shopify or the Worker refused the input; Shopify's messages (e.g. "Zip is invalid") are in `err.userErrors`. Also `orders({ first })` with a `first` that isn't a whole number from 1 to 50, before any request |
| `NETWORK`        | the Worker or Shopify couldn't be reached                                                                                                                                                                       |
| `HTTP_<status>`  | the Worker answered with another error, e.g. `HTTP_502` when Shopify failed behind it, or `HTTP_503` while accounts aren't set up (its `/check` says what is missing)                                           |
| `NOT_CONFIGURED` | `account.server` isn't set                                                                                                                                                                                      |

### Events

On `document`: `tether:account-login` after a login, `tether:account-logout`,
`tether:account-updated` (`detail.what`: profile, addresses, subscriptions, orders), and
`tether:account-error` with `{ error }` when a login didn't work: `'error'` (the login failed: the
Worker sends the visitor back with `?account=error`) or `'expired'` (`?account=expired`: the login
took longer than ten minutes, or came back to another browser).

## Tested

The unit tests run the whole flow against a simulated Shopify: the login (PKCE, nothing
stored before the customer comes back, then only a session cookie), the profile and orders, cart
linking, refresh, the session's lifetime, and logout. They also cover what it must refuse or
survive:

- login CSRF: a callback without this browser's login cookie gets no session;
- a replayed login callback: Shopify refuses the spent code, so no session;
- an expired login (older than ten minutes);
- a tampered or wrongly signed id token;
- a session's sealed KV blob moved under another session's key;
- a `returnTo` on another site (no open redirect);
- a change without the `X-Tether-Account` header, or from another origin;
- logout while Shopify or KV is down, and two requests refreshing at once.
