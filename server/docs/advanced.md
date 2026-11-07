# tether-sync: advanced

The details behind the [sync](../README.md): how it works, the full mapping config, the Node CLI,
manual deploys, limits and costs.

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
- The hash is stored only once the item is **published**, so a failed publish is retried.
- Reconcile stops at the first budget it reaches: `maxChangesPerRun` Webflow writes,
  `maxProductsPerRun` products, `maxPagesPerRun` Shopify pages, or the Worker's subrequest limit.
  It saves the cursor of the last product it did and continues right after it next run, so a bulk
  edit of thousands of products spreads over several runs instead of failing. Each window overlaps
  the previous one by `overlapMinutes` (Shopify's search index lags a little behind updates).
- Failed products, including failed webhooks, go on a retry list and are tried again on the next
  runs, up to 5 attempts each. A failed webhook is stored under a KV key of its own, so a reconcile
  running at that moment can't overwrite it; the next reconcile takes it into the list. A deleted
  product only reaches Webflow through its webhook or this list: the reconcile's cursor finds
  updated products, never deleted ones. If the failure can't be stored either (KV down or out of
  writes for the day), the Worker logs `retry not queued` and the item stays until you remove it,
  or until `tether-sync import --prune` from the Node CLI.
- Webflow slugs are unique, so two runs creating the same product at once (Shopify sends
  `products/create` and `products/update` together) can't make a duplicate: the second one gets
  a conflict, finds the first one's item and updates it.
- Product pages are sized to stay under Shopify's 1,000-point query cost limit (25 variants and
  10 images per product by default), and shrink automatically if Shopify still refuses.
- The client-credentials token (24h) and the Webflow item index (`match.indexTtlMinutes`, a day)
  are cached in the store, so a run doesn't spend requests on them. Listing the index costs one
  request per 100 items. A run that needs it stops listing when its subrequests run out, stores
  the pages it has, and the next run continues from there; a webhook lists at most 15 pages (1,500
  items, about 18 seconds at 50 requests a minute, inside the Worker's 30 seconds after answering)
  and leaves its product to the next reconcile when the index needs more.

## Setup

### 1. Webflow collection

The default mapping ([`tether-sync.config.js`](../tether-sync.config.js)) expects these fields.
Webflow derives the slug from the field name, so naming a field "Compare at price" gives the slug
`compare-at-price`. Fields you don't create are skipped (`webflow.skipMissingFields`), so a
collection with only Name, Slug and Shopify ID works.

| Field name       | Slug               | Type        | From Shopify                                                          |
| ---------------- | ------------------ | ----------- | --------------------------------------------------------------------- |
| Name, Slug       | `name`, `slug`     | built in    | title, handle (so `productPath: '/product'` in Tether keeps working)  |
| **Shopify ID**   | `shopify-id`       | Plain text  | product id: **required**, how items are matched                       |
| Shopify handle   | `shopify-handle`   | Plain text  | handle (bind `tether-product` to it)                                  |
| Description      | `description`      | Rich text   | description HTML, **Webflow-owned**: set once, then edited in Webflow |
| Price            | `price`            | Number      | lowest variant price                                                  |
| Compare at price | `compare-at-price` | Number      | only when on sale                                                     |
| Main image       | `main-image`       | Image       | featured image                                                        |
| Gallery          | `gallery`          | Multi-image | all images                                                            |
| Vendor           | `vendor`           | Plain text  |                                                                       |
| Product type     | `product-type`     | Plain text  |                                                                       |
| Tags             | `tags`             | Plain text  | comma-separated                                                       |
| SKU              | `sku`              | Plain text  | first variant                                                         |
| Available        | `available`        | Switch      | any variant in stock                                                  |

Bind `tether-product` on the template page to the slug (or `shopify-handle`) and Tether takes care
of variants, live prices and the cart.

Find the collection id in the collection settings, or with
`GET https://api.webflow.com/v2/sites/{site_id}/collections`.

### 2. Tokens

| Secret                                        | Where                                                                                                                                               | Scopes                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `WEBFLOW_TOKEN`                               | Webflow → Site settings → Apps & integrations → API access → generate a site token                                                                  | **CMS: read and write**                                   |
| `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` | Shopify **Dev Dashboard** → create an app, install it on your store                                                                                 | `read_products` (+ `read_inventory` if you map inventory) |
| or `SHOPIFY_ADMIN_TOKEN`                      | an existing admin-created custom app (`shpat_…`)                                                                                                    | same                                                      |
| `SHOPIFY_WEBHOOK_SECRET`                      | defaults to `SHOPIFY_CLIENT_SECRET` (app webhooks are signed with it). For webhooks created under Settings → Notifications, use the key shown there |                                                           |

With client id + secret the sync uses Shopify's **client credentials grant**: it requests an
Admin token (valid ~24h) and refreshes it automatically. This works for apps installed on a store
in your own organization. Shopify no longer lets you create new custom apps in the admin; existing
ones keep working with their static token.

These are **server secrets**: never put them in Webflow custom code. The browser only ever gets
Tether's public Storefront token.

### 3. Config

[`tether-sync.config.js`](../tether-sync.config.js) is the config: it works as-is with the standard
collection, taking the store and collection from `SHOPIFY_DOMAIN` and `WEBFLOW_COLLECTION_ID`.
Edit it (in your fork) for a custom mapping, or override in the environment without touching it:

```bash
FIELD_MAP='{"material":"metafield:custom.material","gallery":null}'   # add/change; null removes
WEBFLOW_OWNED='description,intro'
```

In the file:

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
node bin/tether-sync.js check                 # guided first run (below)
node bin/tether-sync.js import --dry-run      # what would happen
node bin/tether-sync.js import                # create/update + publish everything
node bin/tether-sync.js import --prune        # also archive items whose product is gone
node bin/tether-sync.js reconcile             # changed since the last run
node bin/tether-sync.js sync my-handle        # one product
node bin/tether-sync.js serve --port 8787     # webhook endpoint for a Node host (--host 127.0.0.1 behind a proxy)
```

`check` goes through everything in order and says exactly what to fix:

```
✓ Shopify store: your-store.myshopify.com
✓ Shopify access: using client credentials
✗ Webflow token: WEBFLOW_TOKEN is missing.
    fix: Webflow → Site settings → Apps & integrations → API access → generate a token with CMS read and write.
✓ Webflow collection: 6650c1d2e3f4a5b6c7d8e9f0
✓ Webhooks: verified with the app client secret
✗ Connections: Not tested: fix the items above first.

2 thing(s) to fix before syncing.
```

Once everything is set it tests both APIs (rejected token, missing `read_products`, wrong
collection id, token for another site), checks every mapped field against the collection
(missing fields, Image/Number/Switch type mismatches, required fields not mapped, no Shopify ID
field) and prints how a sample product would be written. `--offline` skips the API calls, `--json`
prints the report. It never prints secret values.

State (product → item id + hash, and the reconcile cursor) lives in `.tether-sync-state.json`.
`serve` and a cron `reconcile` can share it: each write takes `.tether-sync-state.json.lock`
first, and a lock older than 30 seconds, left by a process that died, is taken over.
Losing it is harmless: the next run matches items by `shopify-id` again and rewrites each item once.

A large first import runs at the throttle speed: 50 requests/minute ≈ 45 products/minute.
Run it from your machine (or any Node host), not from a free Worker (50 subrequests per run).

### 5. Run it continuously

**Cloudflare Worker (webhooks + cron).** The button above, or by hand:

```bash
cd server
npm install
npx wrangler secret put WEBFLOW_TOKEN        # and SHOPIFY_DOMAIN, WEBFLOW_COLLECTION_ID, the Shopify secrets
npx wrangler deploy                           # your call; this repo never deploys
```

[`wrangler.jsonc`](../wrangler.jsonc) is ready to use: the KV binding (`TETHER_SYNC`, created on the
first deploy), the cron (every 10 minutes) and the entry point. The secrets the button prompts for
are listed in [`.dev.vars.example`](../.dev.vars.example); for local `npx wrangler dev`, copy it to
`.dev.vars`.

Routes: `POST /webhooks/shopify`, `GET /check` (and `/`), `GET /health` (`{ ok: true }`), `POST /reconcile` (needs
`Authorization: Bearer $SYNC_SECRET`; `?since=all` imports everything, continued by the cron).
`/check` with the same header gives the full report, with the running version; without it, only each step's title and level. Every run counts its outgoing requests and stops in time:
`MAX_SUBREQUESTS` (default 45, for the free plan's 50) can be raised on a paid plan. The Worker keeps its own state in KV: without the `TETHER_SYNC` binding, `POST /reconcile` answers 503, the cron run fails, and `/check` (with the secret) warns, or reports an error when customer accounts are on. The first import runs from the Worker
(`POST /reconcile?since=all`), or from the Node CLI: either way items are matched by `shopify-id`, so
nothing is duplicated.

**Node:** `tether-sync serve` behind any HTTPS host, plus `tether-sync reconcile` from cron.

**Vercel / Netlify:** not included. Their serverless functions have no built-in key-value store
(the sync needs one for its cursor and hashes), so it would mean wiring up a third-party database.
The Node CLI runs on any host with cron.

### 6. Shopify webhooks

The Worker registers `products/create`, `products/update` and `products/delete` through the app on
each `POST /reconcile` that finds one missing (signed with the app's client secret, so no extra key).
Shopify deletes a subscription whose deliveries keep failing; when `/check` reports one missing, the
same `POST /reconcile` brings it back. On a Node host,
run `tether-sync webhooks https://your-host` once. Webhooks you create yourself under Settings →
Notifications also work: put their signing key in `SHOPIFY_WEBHOOK_SECRET`. The endpoint answers within Shopify's 5-second limit
and does the work afterwards. A failed webhook is picked up by the next reconcile. Bodies over
1 MB are refused (413), and a delivery Shopify sends again with the same `X-Shopify-Webhook-Id` is
dropped (per Worker instance, without a KV write). A replay later only makes the sync read the
product again: it writes only what changed. One exception: with `onDelete: 'delete'` a deleted
product's stored state goes with its item, so a repeated `products/delete` that still finds the
item in the cached item index tries the delete again (two Webflow requests, both answered "not
found") and stores the index without it (one KV write and one KV delete).

## Costs on free tiers

Check current pricing pages before relying on this; these were the published limits in late 2026.

| Service            | Free tier                                                                                    | What the sync uses                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Workers | 100,000 requests/day, 10 ms CPU per run, 50 subrequests per run, 5 cron triggers per account | 1 request per webhook; a cron every 10 min = 144 runs/day. Waiting on APIs doesn't count as CPU. A run stops at 45 subrequests and resumes next time                                                                                                                                                                                                                                                                                                                       |
| Cloudflare KV      | 100,000 reads/day, 1,000 writes/day, 1,000 deletes/day, 1,000 lists/day                      | 1 read per product checked and 1 list per reconcile run (144/day); writes only when something changed: 1–2 per changed product, the cursor when it moves, 1 per failed webhook, the retry list while it isn't empty, the item index and the Shopify token about once a day. A quiet store's sync writes ~0, but customer accounts share the same 1,000 writes: each login, token refresh and logout writes one. When the day's writes run out, logins fail until 00:00 UTC |
| Shopify Admin API  | included in every plan                                                                       | 1 query per webhook, 1 per ~19 products per reconcile                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Webflow Data API   | included with a site plan; 60 requests/min (Starter/Basic), 120 (CMS/eCommerce/Business)     | ~1–2 per changed product, publishes batched per 100                                                                                                                                                                                                                                                                                                                                                                                                                        |

The real limit is usually Webflow's **CMS item count** for your site plan, not the API.
On the free plan a run handles roughly 15–20 changed products (each is an update plus its share of
a publish); a bigger change spreads over the next runs, every 10 minutes. CPU time per run hasn't
been measured on Cloudflare yet; hashing and mapping a page of products is light, but if you see
CPU-limit errors, lower `maxProductsPerRun`.

## Limitations

- One collection, one locale (localized CMS fields aren't written).
- The Deploy button makes a copy of this folder in your GitHub/GitLab account and needs a Cloudflare account.
- The Update Tether action is GitHub-only; GitLab copies update by running `node scripts/update-tether.mjs` and pushing.
- Image fields are sent as `{ url, alt }`; Webflow downloads them. If an image URL in Shopify
  changes, Webflow gets a new asset.
- Item slugs follow the handle. Changing a handle in Shopify changes the Webflow URL (set up a
  redirect in Webflow).
- Variants aren't synced as separate items; Tether reads them live on the page. `available` and
  `sku` look at the first 25 variants.
- `import` lists products page by page (fine for thousands, from the CLI). It doesn't use
  Shopify bulk operations yet.

## Development

```bash
npm test          # from the repo root: client + server tests (mocked APIs, no network)
```
