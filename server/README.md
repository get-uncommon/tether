# tether-sync: Shopify → Webflow CMS

**A Webflow CMS item for every Shopify product, kept up to date automatically.**
New products appear, changes follow within seconds, and deleted or draft products are archived.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ravi-klaassens/tether/tree/main/server)

- **Free:** runs on Cloudflare's free plan.
- **Hands-off:** registers its own Shopify webhooks, checks every 10 minutes for anything missed, and updates itself.
- **Safe for editors:** only the fields you map are written. Taglines, SEO text and anything else you add in Webflow stay yours.
- **Optional:** Tether works without it. Use it for SEO product pages, CMS lists and filtering.

---

## Setup (about 10 minutes)

**1. Webflow.** Create a Products collection, or use yours, with at least **Name**, **Slug** and a
Plain text field **Shopify ID**. Add any of these and they're filled in too:

> Shopify handle · Description · Price · Compare at price · Main image · Gallery · Vendor ·
> Product type · Tags · SKU · Available

Then go to Site settings → Apps & integrations → API access, and generate a token with
**CMS read and write**.

**2. Shopify.** In the [Dev Dashboard](https://dev.shopify.com/dashboard), create an app with the
scope `read_products`, release it, and install it on your store. Copy its **client ID** and **client secret**.

**3. Deploy.** Click **Deploy to Cloudflare** (above).
- Connect GitHub (or GitLab) for your copy of the code, and tick **Create private Git repository**.
- Fill in the six fields: store domain (`your-store.myshopify.com`), collection ID, Webflow token,
  client ID, client secret, and a `SYNC_SECRET`. Make the secret with `openssl rand -hex 24` and
  **save it** in your password manager.

**4. First import.** Your Worker's URL is under Cloudflare → Workers & Pages → tether-sync → Domains.

```bash
curl -X POST -H "Authorization: Bearer YOUR_SYNC_SECRET" "https://tether-sync.YOUR-NAME.workers.dev/reconcile?since=all"
```

This imports your products and registers the Shopify webhooks. From now on it runs by itself.

**5. Check.** Any time, to see that everything works:

```bash
curl -H "Authorization: Bearer YOUR_SYNC_SECRET" https://tether-sync.YOUR-NAME.workers.dev/check
```

It tests both connections, the field mapping and the webhooks, and shows how a product will be
written. Anything wrong comes with the fix. Without the secret, `/check` answers only each step's
title and level (pass, warning, error), never the store, collection or values.

---

## Updates

Your copy updates itself, like a jsDelivr version. The `TETHER_VERSION` file in your copy decides which releases it takes:

| `TETHER_VERSION` | Gets |
|---|---|
| `0.6` (default) | only 0.6.x fixes |
| `0.6.0` | pinned: never changes |
| `latest` | every release, including a new 0.x minor version, which can need changes in your copy |

A new minor version (0.7) is never installed by itself: when you're ready for it, change the file to `0.7`.

It checks every Monday (want daily? change the `cron` line in your copy's `.github/workflows/update-tether.yml` to `'23 5 * * *'`), and only updates when the new version's tests pass. To update right away: your copy on GitHub → **Actions** → **Update Tether**
→ **Run workflow**. It tests the new version, then Cloudflare redeploys. Your settings stay as they are.
A release is installed by the commit its `v…` tag points at, and only when that commit is on the
Tether repository's `main` branch. `https://YOUR-WORKER/health` answers `{ "ok": true, "version": "…" }`
with the version that's running.

An update replaces `src/`, `bin/`, `scripts/`, `test/`, `docs/`, `package.json` and this README with
the release's, so keep your own code and tests outside those folders. The new release's code runs
only in a job that can read your repository, not change it; a second job commits the tested change.

**Product descriptions.** The sync writes Shopify's description HTML into the Webflow field as it
is. Anyone who can edit products in Shopify, apps included, writes that HTML, and the sync does not
clean it. On a page that shows it through `tether-bind="description"`, Tether's script cleans it in
the browser. Webflow doesn't document what its rich-text field strips, so don't count on that: if
your pages render the field themselves and you don't trust everyone who can edit products, map
`description` to the plain-text `description` source instead.

## Several stores or client sites

One deploy per store: each click creates its own Worker for one store and one Webflow collection.
- **Client stores:** create the Shopify app in the **client's** Dev Dashboard, because the app and
  the store must be in the same organization. Deploying on the client's own Cloudflare account
  makes handover easy.
- **Free plan:** Cloudflare's free plan allows 5 cron triggers per account, so about 5 stores per account.

## Optional settings

Add these later as secrets, only if you need them: Cloudflare → your Worker → Settings → Variables and Secrets.

| Secret | When |
|---|---|
| `FIELD_MAP` | Other fields or metafields: `{"material":"metafield:custom.material"}` |
| `WEBFLOW_OWNED` | Fields Shopify fills in once, then editors own: `description,intro` |
| `SHOPIFY_ADMIN_TOKEN` | Stores with an old admin-created custom app (`shpat_…`) instead of a Dev Dashboard app |
| `SHOPIFY_WEBHOOK_SECRET` | Webhooks you created yourself under Shopify → Settings → Notifications |
| `ACCOUNT_CLIENT_ID`, `ACCOUNT_ORIGINS`, `STOREFRONT_TOKEN` (+ `ACCOUNT_CLIENT_SECRET`) | Customer accounts through this Worker, the safe mode: the browser never holds a Shopify token. Needs the `TETHER_SYNC` KV binding, which the deploy creates ([setup](../docs/accounts.md#server-mode)) |
| `ACCOUNT_SECRET` | Set it with customer accounts: 24+ random characters, the sessions' own encryption key. Without it the key comes from `SYNC_SECRET`, the `/reconcile` password, and `/check` warns. Setting it later logs every customer out once |
| `DEPLOY_HOOK_URL` | A statically built site (Astro, …): start a build when product content changes ([how](../docs/astro.md#7-rebuild-when-products-change)). Without Webflow, set the Webflow fields to `none` |
| `DEPLOY_HOOK_MIN_SECONDS` | At most one build per this many seconds (default 60) |
| `MAX_SUBREQUESTS` | A paid Workers plan, to let each run do more (default 45) |

## Costs

Free for a normal shop. Cloudflare's free plan covers the Worker, storage and cron. The Shopify
and Webflow APIs are included in your plans. The real limit is usually your Webflow plan's number
of CMS items. Details: [costs on free tiers](docs/advanced.md#costs-on-free-tiers).

---

**More:** how it works, the full field mapping, the Node CLI (for hosts other than Cloudflare),
manual deploys and limits are in [docs/advanced.md](docs/advanced.md).
