# Tether vs Smootify vs Storesynk (Shopyflow)

Three ways to sell Shopify products on a Webflow site. Tether is free and open source; Smootify
and Storesynk (formerly Shopyflow) are paid services with support and visual tooling. This page
tries to be fair: where something couldn't be confirmed from the vendor's own pages, it says so.

*Checked on 4 November 2026 from the vendors' public pages (links below). Prices and features
change, so check the sources before you decide. Corrections are welcome: open an issue.*

## At a glance

| | **Tether** | **Smootify** | **Storesynk** (formerly Shopyflow) |
|---|---|---|---|
| **Price** | Free (MIT open source) | Free (staging only), Lite $19/mo, Server $49/mo, per store | Free (webflow.io, 5 products synced), Launch $59/mo, Multi-storefront $177/mo (5 projects) |
| **Billed** | Never | Per store, on your Shopify invoice | Every 30 days, via Shopify |
| **Custom domain** | Yes | Lite and up | Launch and up |
| **How it works** | Script tag + HTML attributes | Script + attributes / custom elements, Shopify app | Shopify app + Webflow app |
| **Live prices, stock, variants** | Yes (Storefront API) | Yes (Storefront API) | Yes |
| **Products → Webflow CMS** | Optional, [self-hosted sync](../server/README.md) (free on Cloudflare) | Server plan (webhooks), or a desktop app (Free/Lite, run by hand) | Yes, real-time (Free: 5 products) |
| **Subscriptions** | Yes: any app using Shopify selling plans (Shopify Subscriptions, Recharge, Skio, Loop, Appstle, …) | Subscription pages in customer accounts; supported apps unconfirmed | Unconfirmed |
| **Cart drawer, discount codes, notes** | Yes | Cart, mini cart, upsells, free-shipping bar; discount codes unconfirmed | Unconfirmed |
| **Markets / multi-currency** | Yes: country selector, Webflow Localization, cart follows | Yes, with a markets switcher | Unconfirmed |
| **Bundles / build-a-box** | Yes (`tether-group`, Shopify Bundles) | Yes (Shopify Bundles, Magic Box) | Yes (sub-products, cross-sells) |
| **Customer accounts** | Links to Shopify customer accounts | Yes (orders, subscriptions) | Unconfirmed |
| **Search** | Product lists from Shopify search queries | Predictive search, Search & Discovery | Unconfirmed |
| **Page transitions (Barba, Swup)** | Yes, with a preset | Unconfirmed | Unconfirmed |
| **B2B / wholesale pricing** | No | Unconfirmed | Yes |
| **Source code** | Open (GitHub) | Closed | Closed |
| **Runs on** | jsDelivr or your own hosting; the sync on your own Cloudflare | Their app and, for sync, their server | Their apps and sync |
| **If you stop paying** | Nothing to stop | Not documented | Not documented |
| **Support** | GitHub issues | Discord (Free), tickets (Lite and up) | Via the vendor |

## Cost over a year

For one store on a custom domain:

| | Tether | Smootify Lite | Smootify Server | Storesynk Launch |
|---|---|---|---|---|
| **Per year** | $0 | $180–228 | $468–588 | $588–708 |
| **With CMS sync** | $0 (Cloudflare free plan) | desktop app only | included | included |

Add five client stores and the gap grows with every store: paid tools charge per store or
project, while Tether and its sync stay free.

## When a paid tool is the better fit

- **You want a visual setup** inside Webflow, without custom attributes.
- **You need vendor support** with a response time, or features Tether doesn't have: predictive
  search, upsells, B2B/wholesale pricing, a built-in customer login, reviews or forms.
- **Your team doesn't want** to own any setup at all, not even a Cloudflare deploy.

## When Tether fits

- **You build Webflow sites** and are fine with custom attributes.
- **No per-store fees:** you want a monthly price of zero, for every store.
- **Subscriptions through selling plans**, page transitions, and markets handled in the open.
- **You can read the code**, fix things yourself, and keep everything running without depending
  on a vendor.

## Sources

- Smootify pricing: <https://www.smootify.io/pricing>
- Smootify product and docs: <https://www.smootify.io>, <https://docs.smootify.io>
- Smootify CMS sync: <https://docs.smootify.io/docs/getting-started/quick-start/import-and-sync>
- Storesynk on the Shopify App Store: <https://apps.shopify.com/storesynk>
- Shopyflow on Webflow integrations: <https://webflow.com/integrations/shopyflow>
- Webflow's own Shopify options: <https://webflow.com/integrations/shopify>

Smootify, Shopyflow and Storesynk are trademarks of their owners. Tether isn't affiliated with them.
