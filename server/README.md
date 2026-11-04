# tether-sync: Shopify → Webflow CMS

Optional. Tether works without it (prices, stock and variants always come live from Shopify in the
browser). Use the sync when you want a **Webflow CMS item per Shopify product**: SEO-friendly
product pages, CMS collection lists, filtering with Finsweet, and editors writing extra content
in Webflow next to the Shopify data.

- **Webhooks** (`products/create`, `products/update`, `products/delete`), HMAC-verified: a change
  in Shopify shows up in Webflow within seconds.
- **Reconcile** (cron): catches anything a webhook missed, from the last run onwards. Idempotent.
- **Import**: the first full sync, with optional pruning of orphaned items.
- **Field mapping** per project, with **Webflow-owned** fields that the sync never overwrites.
- **Throttled** to Webflow's rate limit, retries 429s with `Retry-After`.
- Runs as a **Cloudflare Worker** (webhooks + cron) **or** a **Node CLI** (≥ 20). No dependencies.

Nothing here deploys itself. You run `wrangler deploy` (or host the Node server) when you're ready.

## How it works

```
Shopify ──webhook──▶ /webhooks/shopify ─┐
        ◀─Admin API: fetch product──────┤  map fields ─▶ hash ─▶ unchanged? stop
cron ───▶ reconcile (updated_at ≥ cursor)┘                     └▶ create / update / archive item
                                                                  ▶ publish (batched)
```

- Webhooks only carry the product id. The sync always re-fetches the **current** product from the
  Admin API, so out-of-order or duplicate webhooks can't write stale data.
- Items are matched on a `shopify-id` field (the numeric product id). Existing hand-made items
  whose slug equals the Shopify handle are adopted on the first run (`match.bySlug`).
- The mapped field data is hashed and stored per product. Same hash → no Webflow request. That
  makes import and reconcile safe to run any number of times, and keeps Webflow image fields
  from being re-uploaded on every run.
- Draft/archived products (status ≠ ACTIVE) are archived and unpublished in Webflow
  (`inactive`). Deleted products are archived by default (`onDelete: 'archive' | 'delete' | 'unpublish'`).
- Reconcile stops after `maxChangesPerRun` Webflow writes and continues from there next run.
  Products that failed are retried on the next runs (up to 5 times).

## Setup

### 1. Webflow collection

Create (or reuse) a Products collection with at least:

| Field | Type | Notes |
|---|---|---|
| Name, Slug | built in | slug = Shopify handle, so `productPath: '/product'` in Tether keeps working |
| `shopify-id` | Plain text | stores the product id; how items are matched |

Add whatever else you map: price (Number), main image (Image), gallery (Multi-image),
description (Rich text), vendor (Plain text), and so on. Bind `tether-product` on the template
page to the slug (or `shopify-id`) and Tether takes care of variants, prices and the cart.

Find the collection id in the collection settings, or with
`GET https://api.webflow.com/v2/sites/{site_id}/collections`.

### 2. Tokens

| Secret | Where | Scopes |
|---|---|---|
| `WEBFLOW_TOKEN` | Webflow → Site settings → Apps & integrations → API access → generate a site token | **CMS: read and write** |
| `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` | Shopify **Dev Dashboard** → create an app, install it on your store | `read_products` (+ `read_inventory` if you map inventory) |
| or `SHOPIFY_ADMIN_TOKEN` | an existing admin-created custom app (`shpat_…`) | same |
| `SHOPIFY_WEBHOOK_SECRET` | defaults to `SHOPIFY_CLIENT_SECRET` (app webhooks are signed with it). For webhooks created under Settings → Notifications, use the key shown there | |

With client id + secret the sync uses Shopify's **client credentials grant**: it requests an
Admin token (valid ~24h) and refreshes it automatically. This works for apps installed on a store
in your own organization. Shopify no longer lets you create new custom apps in the admin; existing
ones keep working with their static token.

These are **server secrets**: never put them in Webflow custom code. The browser only ever gets
Tether's public Storefront token.

### 3. Config

```bash
cd server
cp tether-sync.config.example.js tether-sync.config.js   # edit domain, collectionId, fields
```

```js
fields: {
  name: 'title',
  slug: 'handle',
  'shopify-id': 'legacyId',
  price: 'price',                         // min variant price, a number
  'main-image': 'image',                  // { url, alt }
  gallery: 'images',
  material: 'metafield:custom.material',  // fetched automatically
  'first-sku': 'variants.0.sku',
  badge: (p) => (p.compareAtPrice ? 'Sale' : ''),
},
webflowOwned: ['description'],            // set on create, then edited in Webflow only
```

Sources: `title`, `handle`, `legacyId`, `id` (gid), `description`, `descriptionHtml`, `vendor`,
`productType`, `tags` (list), `tagsText`, `status`, `price`, `maxPrice`, `compareAtPrice` (only when
on sale), `currency`, `image`, `images`, `available`, `totalInventory` (needs `inventory: true`),
`sku`, `variantCount`, `seoTitle`, `seoDescription`, `onlineStoreUrl`, `createdAt`, `updatedAt`,
`publishedAt`, dotted paths, `metafield:ns.key`, `'=constant'` or a function. Option and reference
fields need Webflow ids: map them with a function.

Fields that aren't in the mapping are never touched, so editors can add any extra fields. Put a
mapped field in `webflowOwned` when Shopify should only provide the first version.

### 4. Check and import (Node)

```bash
export WEBFLOW_TOKEN=... SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=...   # or a .env next to the config
node bin/tether-sync.js check                 # tokens, collection, mapping vs. field types, sample output
node bin/tether-sync.js import --dry-run      # what would happen
node bin/tether-sync.js import                # create/update + publish everything
node bin/tether-sync.js import --prune        # also archive items whose product is gone
node bin/tether-sync.js reconcile             # changed since the last run
node bin/tether-sync.js sync my-handle        # one product
node bin/tether-sync.js serve --port 8787     # webhook endpoint for a Node host
```

State (product → item id + hash, and the reconcile cursor) lives in `.tether-sync-state.json`.
Losing it is harmless: the next run matches items by `shopify-id` again and rewrites each item once.

A large first import runs at the throttle speed: 50 requests/minute ≈ 45 products/minute.
Run it from your machine (or any Node host), not from a free Worker (50 subrequests per run).

### 5. Run it continuously

**Cloudflare Worker (webhooks + cron):**

```bash
cd server
cp worker.example.js worker.js && cp wrangler.example.toml wrangler.toml
npx wrangler kv namespace create TETHER_SYNC          # put the id in wrangler.toml
npx wrangler secret put WEBFLOW_TOKEN                 # and the Shopify secrets
npx wrangler deploy                                   # your call; this repo never deploys
```

Routes: `POST /webhooks/shopify`, `GET /health`, `POST /reconcile` (needs
`Authorization: Bearer $SYNC_SECRET`). Run the import once from Node first. The Worker keeps its
own state in KV. Its first reconcile looks back `lookbackMinutes` and finds the imported items by
`shopify-id`, so nothing is duplicated. The first time the Worker touches an already-imported
product, it rewrites that item once, because the hash isn't in KV yet.

**Node:** `tether-sync serve` behind any HTTPS host, plus `tether-sync reconcile` from cron.

### 6. Shopify webhooks

Subscribe to `products/create`, `products/update` and `products/delete` (JSON) with the URL
`https://<your-worker>/webhooks/shopify`, in the app's `shopify.app.toml` / Dev Dashboard, or
under Settings → Notifications → Webhooks. The endpoint answers within Shopify's 5-second limit
and does the work afterwards. A failed webhook is picked up by the next reconcile.

## Costs on free tiers

Check current pricing pages before relying on this; these were the published limits in late 2026.

| Service | Free tier | What the sync uses |
|---|---|---|
| Cloudflare Workers | 100,000 requests/day, 10 ms CPU per run, 50 subrequests per run, 5 cron triggers per account | 1 request per webhook; a cron every 10 min = 144 runs/day. Waiting on APIs doesn't count as CPU |
| Cloudflare KV | 100,000 reads/day, 1,000 writes/day | writes only when a product changed (1–2 per change) and when the cursor moves. A quiet store writes ~0 |
| Shopify Admin API | included in every plan | 1 query per webhook, 1 per 50 products per reconcile |
| Webflow Data API | included with a site plan; 60 requests/min (Starter/Basic), 120 (CMS/eCommerce/Business) | ~1–2 per changed product, publishes batched per 100 |

The real limit is usually Webflow's **CMS item count** for your site plan, not the API.
With `maxChangesPerRun: 20`, a reconcile stays well under a free Worker's 50 subrequests.

## Limitations

- One collection, one locale (localized CMS fields aren't written).
- Image fields are sent as `{ url, alt }`; Webflow downloads them. If an image URL in Shopify
  changes, Webflow gets a new asset.
- Item slugs follow the handle. Changing a handle in Shopify changes the Webflow URL (set up a
  redirect in Webflow).
- Variants aren't synced as separate items; Tether reads them live on the page.

## Development

```bash
npm test          # from the repo root: client + server tests (mocked APIs, no network)
```
