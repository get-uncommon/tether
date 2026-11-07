# Analytics

Turn it on in the config; the analytics part (3 KB) loads only then.

```js
window.TETHER_CONFIG = {
  …,
  analytics: {
    dataLayer: true,          // Google Analytics 4 / Google Tag Manager
    shopify: true,            // Shopify's own analytics (experimental, see below)
    onEvent(name, data) {},   // anything else: Meta, TikTok, Plausible, your own
  },
};
```

## Google Analytics 4 / Tag Manager

Tether pushes Google's standard ecommerce events to `window.dataLayer` (another name:
`dataLayer: 'myLayer'`), clearing the previous ecommerce object first, as Google asks:

| Event                             | When                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `view_item`                       | the page's product has loaded (not cards in lists)                                                        |
| `view_item_list`                  | a list (`tether-collection`, `tether-products`, recommendations) has loaded                               |
| `add_to_cart`, `remove_from_cart` | the cart changed: add-to-cart buttons, +/−, typed quantities, your own JS. The quantity is the difference |
| `view_cart`                       | the cart drawer opened                                                                                    |
| `begin_checkout`                  | the visitor goes to checkout (with the applied discount codes as `coupon`)                                |
| `search`                          | search as you type got an answer, also one without results (`search_term`)                                |

Items have `item_id` (variant SKU, or the variant's numeric id), `item_name`, `item_variant`,
`item_brand` (vendor), `item_category` (product type), `price` and `quantity`; events have
`currency` and `value`.

The events come from Tether's own `tether:*` events, and only from those Tether itself sent: a
look-alike event another script dispatches (`tether:cart-updated` with any detail) sends nothing.

In Tag Manager: a GA4 Event tag per event name (or one with `{{Event}}`), with "Send ecommerce
data" on. Consent: Tag Manager's consent mode applies as usual.

**Purchases** happen on Shopify's checkout, so no script on your site sees them. Use Shopify's
**Google & YouTube** app, or a custom pixel under Settings → Customer events, for `purchase`.

## Shopify analytics (experimental)

Headless stores don't show up in Shopify's Analytics (sessions, conversion, top products) unless
the site sends Shopify those events. With `shopify: true`, Tether does what Hydrogen does: it sets
up Shopify's event bus (`window.Shopify.analytics`), loads Shopify's **Customer Privacy API** and
Shopify's own `shopify.js`, and publishes page, product, collection, search and add-to-cart events.
Shopify's script builds and sends them, so the data format stays Shopify's.

- **Page views:** one for the page the visitor lands on and one for each page after it: an Astro
  client-side navigation, or with page transitions (Barba, Swup) each new page's container
  `Tether.mount(container)` mounts with a `Tether.unmount()` for the page left, before or after
  the mount, as in the [page transitions setup](reference.md#with-page-transitions-barba-swup-). A
  page transition that skips `Tether.unmount()` sends no page view.
- **Consent:** nothing is sent until the Customer Privacy API allows analytics (the visitor's
  choice, and your region settings under Settings → Customer privacy). Options:
  `consent: 'no-banner'` (default: your own banner calls `Shopify.customerPrivacy.setTrackingConsent`),
  or `'default-banner'` for Shopify's banner.
- **Exact visitor counts** need the Storefront API on your own domain (a small proxy route, e.g. a
  Cloudflare Worker for `/api/*/graphql.json` → your store). Without it, Shopify may count a new
  visitor more often than it should. Set `shopify: { proxy: true }` when you have one: Shopify's
  consent script then works with your own domain instead of the store's token.
- **Experimental:** Tether's browser tests run Shopify's real scripts: nothing goes out before
  consent, and after it Shopify's script sends `product_page_rendered` and `product_added_to_cart`.
  What these tests can't show is the result in Shopify's reports: check a real store under
  Analytics → Reports → Sessions by sales channel ("Headless") after a day. Shopify can change
  its scripts without notice.

## Everything else

`onEvent(name, data)` gets the same events with the same GA4-style data (`view_item`,
`add_to_cart`, …), for any tool. Or listen to Tether's own events (`tether:product-added`,
`tether:cart-updated`, …), see the [reference](reference.md#javascript-api).
