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
written. Anything wrong comes with the fix.

---

## Updates

Your copy updates itself, like a jsDelivr version. The `TETHER_VERSION` file in your copy decides which releases it takes:

| `TETHER_VERSION` | Gets |
|---|---|
| `0.4` (default) | every 0.4.x fix, automatically |
| `0.4.0` | pinned: never changes |
| `latest` | every release, also new minor versions |

It checks every Monday. To update right away: your copy on GitHub → **Actions** → **Update Tether**
→ **Run workflow**. It tests the new version, then Cloudflare redeploys. Your settings stay as they are.
`https://YOUR-WORKER/health` shows the version that's running.

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
| `MAX_SUBREQUESTS` | A paid Workers plan, to let each run do more (default 45) |

## Costs

Free for a normal shop. Cloudflare's free plan covers the Worker, storage and cron. The Shopify
and Webflow APIs are included in your plans. The real limit is usually your Webflow plan's number
of CMS items. Details: [costs on free tiers](docs/advanced.md#costs-on-free-tiers).

---

**More:** how it works, the full field mapping, the Node CLI (for hosts other than Cloudflare),
manual deploys and limits are in [docs/advanced.md](docs/advanced.md).
