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

Nothing here deploys itself. You click the button (or run `wrangler deploy`, or host the Node server) when you're ready.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ravi-klaassens/tether/tree/main/server)

The button forks this repo into your GitHub account, creates the Worker, its KV namespace and the
10-minute cron on your Cloudflare account, and asks for the values below. Then open
`https://<your-worker>.workers.dev/check` to see what's still missing (see [Quick start](#quick-start-deploy-button)).

## Quick start (Deploy button)

1. **Webflow:** a Products collection with at least Name, Slug and a Plain text field **Shopify ID**
   (the other [standard fields](#1-webflow-collection) are optional). Then Site settings → Apps &
   integrations → API access → generate a token with **CMS read and write**.
2. **Shopify:** in the [Dev Dashboard](https://dev.shopify.com/dashboard), create an app with the
   scope `read_products`, release it and install it on your store. Copy its client id and secret.
3. **Deploy:** click **Deploy to Cloudflare** (above). Connect a GitHub (or GitLab) account for the
   copy of the code (tick "private"), and fill in the six fields: store domain, collection id,
   Webflow token, client id, client secret, and a `SYNC_SECRET` (`openssl rand -hex 24`; **save it**).
4. **First import** (also registers the Shopify webhooks, so there's nothing to set up in Shopify):
   ```bash
   curl -X POST -H "Authorization: Bearer $SYNC_SECRET" "https://<worker>.workers.dev/reconcile?since=all"
   ```
   The Worker URL is in Cloudflare → Workers & Pages → tether-sync → Domains.
5. **Check** any time: `curl -H "Authorization: Bearer $SYNC_SECRET" https://<worker>.workers.dev/check`
   tests both APIs, the field mapping and the webhooks, and shows how a sample product is written.

From then on product changes reach Webflow within seconds (webhooks), and the cron catches
anything missed every 10 minutes.

**Optional settings**, added later as secrets (Cloudflare → the Worker → Settings → Variables and
Secrets) only when you need them:

| Secret | When |
|---|---|
| `FIELD_MAP` | Change the mapping without editing code: `{"material":"metafield:custom.material","gallery":null}` |
| `WEBFLOW_OWNED` | Fields written only when an item is created: `description,intro` |
| `SHOPIFY_ADMIN_TOKEN` | A store with an old admin-created custom app (`shpat_…`) instead of a Dev Dashboard app |
| `SHOPIFY_WEBHOOK_SECRET` | Webhooks you created yourself under Shopify Settings → Notifications (their signing key) |
| `MAX_SUBREQUESTS` | On a paid Workers plan, to let a run do more (default 45) |

**Updates:** each deployed copy updates itself, like a jsDelivr version range. Its
`TETHER_VERSION` file says which releases it takes:

| `TETHER_VERSION` | Gets |
|---|---|
| `0.3` (default) | every 0.3.x patch, automatically |
| `0.3.3` | nothing: pinned |
| `latest` | every release, including new minor versions (which may change behaviour) |

`GET /health` shows the version a Worker runs. The copy's GitHub Action **Update Tether** checks every Monday; to update right away, open the copy
on GitHub → Actions → Update Tether → Run workflow. It tests the new version first, commits it,
and Cloudflare redeploys. Only the code changes: your `tether-sync.config.js` (mapping),
`wrangler.jsonc` (Cloudflare ids) and the secrets stay as they are. To change the range, edit
`TETHER_VERSION` in the copy on GitHub. A run takes seconds, well inside GitHub's free Actions minutes.
The Action keeps its own weekly schedule alive (GitHub otherwise pauses schedules in public repos
after 60 quiet days), and `/check` warns when a newer release in the range is out but not installed.

**Several stores:** one deploy per store and Webflow collection (each click creates its own Worker,
storage and cron). The Shopify app must be in the same organization as the store, so for a client
store, create it in the client's Dev Dashboard. Cloudflare's free plan allows 5 cron triggers per
account.

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
  It saves its exact position (page and offset) and continues there next run, so a bulk edit of
  thousands of products spreads over several runs instead of failing. Each window overlaps the
  previous one by `overlapMinutes` (Shopify's search index lags a little behind updates).
- Failed products, including failed webhooks, are retried on the next runs (up to 5 times).
- Webflow slugs are unique, so two runs creating the same product at once (Shopify sends
  `products/create` and `products/update` together) can't make a duplicate: the second one gets
  a conflict, finds the first one's item and updates it.
- Product pages are sized to stay under Shopify's 1,000-point query cost limit (25 variants and
  10 images per product by default), and shrink automatically if Shopify still refuses.
- The client-credentials token (24h) and the Webflow item index (`match.indexTtlMinutes`, a day)
  are cached in the store, so a run doesn't spend requests on them.

## Setup

### 1. Webflow collection

The default mapping ([`tether-sync.config.js`](tether-sync.config.js)) expects these fields.
Webflow derives the slug from the field name, so naming a field "Compare at price" gives the slug
`compare-at-price`. Fields you don't create are skipped (`webflow.skipMissingFields`), so a
collection with only Name, Slug and Shopify ID works.

| Field name | Slug | Type | From Shopify |
|---|---|---|---|
| Name, Slug | `name`, `slug` | built in | title, handle (so `productPath: '/product'` in Tether keeps working) |
| **Shopify ID** | `shopify-id` | Plain text | product id: **required**, how items are matched |
| Shopify handle | `shopify-handle` | Plain text | handle (bind `tether-product` to it) |
| Description | `description` | Rich text | description HTML, **Webflow-owned**: set once, then edited in Webflow |
| Price | `price` | Number | lowest variant price |
| Compare at price | `compare-at-price` | Number | only when on sale |
| Main image | `main-image` | Image | featured image |
| Gallery | `gallery` | Multi-image | all images |
| Vendor | `vendor` | Plain text | |
| Product type | `product-type` | Plain text | |
| Tags | `tags` | Plain text | comma-separated |
| SKU | `sku` | Plain text | first variant |
| Available | `available` | Switch | any variant in stock |

Bind `tether-product` on the template page to the slug (or `shopify-handle`) and Tether takes care
of variants, live prices and the cart.

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

[`tether-sync.config.js`](tether-sync.config.js) is the config: it works as-is with the standard
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
node bin/tether-sync.js serve --port 8787     # webhook endpoint for a Node host
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

[`wrangler.jsonc`](wrangler.jsonc) is ready to use: the KV binding (`TETHER_SYNC`, created on the
first deploy), the cron (every 10 minutes) and the entry point. The secrets the button prompts for
are listed in [`.dev.vars.example`](.dev.vars.example); for local `npx wrangler dev`, copy it to
`.dev.vars`.

Routes: `POST /webhooks/shopify`, `GET /check` (and `/`), `GET /health`, `POST /reconcile` (needs
`Authorization: Bearer $SYNC_SECRET`; `?since=all` imports everything, continued by the cron). Every run counts its outgoing requests and stops in time:
`MAX_SUBREQUESTS` (default 45, for the free plan's 50) can be raised on a paid plan. The Worker keeps its own state in KV. Run the first import
from Node: the Worker's first reconcile looks back `lookbackMinutes` and finds the imported items
by `shopify-id`, so nothing is duplicated. The first time the Worker touches an already-imported
product it rewrites that item once, because the hash isn't in KV yet.

**Node:** `tether-sync serve` behind any HTTPS host, plus `tether-sync reconcile` from cron.

**Vercel / Netlify:** not included. Their serverless functions have no built-in key-value store
(the sync needs one for its cursor and hashes), so it would mean wiring up a third-party database.
The Node CLI runs on any host with cron.

### 6. Shopify webhooks

The Worker registers `products/create`, `products/update` and `products/delete` through the app on
its first `POST /reconcile` (signed with the app's client secret, so no extra key). On a Node host,
run `tether-sync webhooks https://your-host` once. Webhooks you create yourself under Settings →
Notifications also work: put their signing key in `SHOPIFY_WEBHOOK_SECRET`. The endpoint answers within Shopify's 5-second limit
and does the work afterwards. A failed webhook is picked up by the next reconcile.

## Costs on free tiers

Check current pricing pages before relying on this; these were the published limits in late 2026.

| Service | Free tier | What the sync uses |
|---|---|---|
| Cloudflare Workers | 100,000 requests/day, 10 ms CPU per run, 50 subrequests per run, 5 cron triggers per account | 1 request per webhook; a cron every 10 min = 144 runs/day. Waiting on APIs doesn't count as CPU. A run stops at 45 subrequests and resumes next time |
| Cloudflare KV | 100,000 reads/day, 1,000 writes/day | 1 read per product checked; writes only when something changed: 1–2 per changed product, the cursor when it moves, the item index and the Shopify token about once a day. A quiet store writes ~0 |
| Shopify Admin API | included in every plan | 1 query per webhook, 1 per ~19 products per reconcile |
| Webflow Data API | included with a site plan; 60 requests/min (Starter/Basic), 120 (CMS/eCommerce/Business) | ~1–2 per changed product, publishes batched per 100 |

The real limit is usually Webflow's **CMS item count** for your site plan, not the API.
On the free plan a run handles roughly 15–20 changed products (each is an update plus its share of
a publish); a bigger change spreads over the next runs, every 10 minutes. CPU time per run hasn't
been measured on Cloudflare yet; hashing and mapping a page of products is light, but if you see
CPU-limit errors, lower `maxProductsPerRun`.

## Limitations

- One collection, one locale (localized CMS fields aren't written).
- The Deploy button needs a public GitHub/GitLab repo (it forks this one) and a Cloudflare account.
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
