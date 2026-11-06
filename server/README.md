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

The webhooks go to the address you called `/reconcile` on. Shopify sometimes sends a webhook twice.
On `workers.dev`, a repeat that reaches another copy of the Worker is synced again. That costs one
Shopify read and one KV read, and nothing is written. When the webhooks were registered on your
own domain (a route or custom domain, as customer accounts need), Cloudflare's cache drops those
repeats too.

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

| `TETHER_VERSION` | Gets                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `X.Y`            | only fixes of that minor version (`X.Y.z`). A new copy starts on the minor version it was made from |
| `X.Y.Z`          | pinned: never changes                                                                               |
| `latest`         | every release, including a new 0.x minor version, which can need changes in your copy               |

Under `X.Y` a new minor version is never installed by itself. When you're ready for one, do its
one-time upgrade steps from the [CHANGELOG](../CHANGELOG.md), then change the file to its `X.Y`.
Under `latest` it is installed on the next scheduled run after its release, so do those steps
before then.

**Copies made from 0.6.1 to 0.6.8** have `latest` in `TETHER_VERSION`, unless you changed it, so
they installed 0.7.0 by themselves, and an update never changes that file: they will install 0.8.0
by themselves too. Write `0.7` in the file to stay on the 0.7 line, as copies made from 0.7.0 do.
With customer accounts, 0.7.0 needs the `ACCOUNT_SECRET` secret (see
[Optional settings](#optional-settings)). A copy that updated without it keeps syncing, answering
webhooks and starting deploys; only its account routes answer 503 with
`accounts need the Worker secret ACCOUNT_SECRET`, and `/check` shows the same error, until you add
the secret.

It checks every Monday (want daily? change the `cron` line in your copy's `.github/workflows/update-tether.yml` to `'23 5 * * *'`), and only updates when the new version's tests pass. To update right away: your copy on GitHub → **Actions** → **Update Tether**
→ **Run workflow**. It tests the new version, then Cloudflare redeploys. Your settings stay as they are.
A release is installed only when the commit its `v…` tag points at is on the Tether repository's
`main` branch, and only from the signed `tether-server-X.Y.Z.tar.gz` on its GitHub Release: the
updater runs `gh attestation verify` to check that Tether's release workflow built that file from
that commit, and refuses it otherwise. Releases before 0.7.0 have no signed file, so a copy on 0.7.0
or newer never installs one of them. A new tag gets its file a few minutes after it is pushed, when
Tether's release workflow has passed; until then the update run skips it with a warning and installs
the newest release that has one. The `/check` report you get with your `SYNC_SECRET` (the `curl`
above) starts with the `version` that's running.

To update by hand (`node scripts/update-tether.mjs` in your copy), install the
[GitHub CLI](https://cli.github.com) first. Without it the updater refuses, unless you pass
`--allow-unverified`, which installs the release without checking where the file came from. A
check that `gh` runs and that fails is always refused.

**The workflow file.** GitHub doesn't let a workflow change its own file, so an update never
replaces `.github/workflows/update-tether.yml`. When a release needs a newer one, the update run
shows a warning and a note in its summary (Actions → the run). Then, once, by hand: open the
release's `server/.github/workflows/update-tether.yml` on GitHub
(`https://github.com/ravi-klaassens/tether/tree/vX.Y.Z/server/.github/workflows`), copy it over the
same file in your copy and commit it (keep your own `cron` line if you changed it).
Until you do, a copy made before 0.7.0 keeps a workflow that can't tell when the update itself
fails: the run stays green and installs nothing, with an error annotation saying why (Actions → the
run → Annotations) next to that warning. With the new file, a failed update fails the run.

An update replaces `src/`, `bin/`, `scripts/`, `test/`, `docs/`, `package.json`, this README,
`.dev.vars.example` and `.gitignore` with the release's, so keep your own code and tests outside
those folders, and lines you add to `.gitignore` are dropped by the next update: ignore your own
files in a `.gitignore` inside your own folder instead. The new release's code runs
only in a job that can read your repository, not change it; a second job commits the tested change,
exactly as it was recorded before the tests ran.

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

| Secret                                                                                 | When                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FIELD_MAP`                                                                            | Other fields or metafields: `{"material":"metafield:custom.material"}`                                                                                                                                                                                                         |
| `WEBFLOW_OWNED`                                                                        | Fields Shopify fills in once, then editors own: `description,intro`                                                                                                                                                                                                            |
| `SHOPIFY_ADMIN_TOKEN`                                                                  | Stores with an old admin-created custom app (`shpat_…`) instead of a Dev Dashboard app                                                                                                                                                                                         |
| `SHOPIFY_WEBHOOK_SECRET`                                                               | Webhooks you created yourself under Shopify → Settings → Notifications                                                                                                                                                                                                         |
| `ACCOUNT_CLIENT_ID`, `ACCOUNT_ORIGINS`, `STOREFRONT_TOKEN` (+ `ACCOUNT_CLIENT_SECRET`) | Customer accounts through this Worker: the browser never holds a Shopify token. Needs the `TETHER_SYNC` KV binding, which the deploy creates, and `ACCOUNT_SECRET` ([setup](../docs/accounts.md#setup))                                                                        |
| `ACCOUNT_SECRET`                                                                       | Required with customer accounts: 24+ random characters, not the same as `SYNC_SECRET`, the sessions' own encryption key. Without it, or with the value of `SYNC_SECRET`, the account routes answer 503 and `/check` says what to set. Changing it logs every customer out once |
| `DEPLOY_HOOK_URL`                                                                      | A statically built site (Astro, …): start a build when product content changes ([how](../docs/astro.md#7-rebuild-when-products-change)). Without Webflow, set the Webflow fields to `none`                                                                                     |
| `DEPLOY_HOOK_MIN_SECONDS`                                                              | At most one build per this many seconds: a whole number from 0 to 86400 (default 60)                                                                                                                                                                                           |
| `MAX_SUBREQUESTS`                                                                      | A paid Workers plan, to let each run do more: a whole number from 1 to 10000000 (default 45). `/check` reports a value it can't use, for this and `DEPLOY_HOOK_MIN_SECONDS`                                                                                                    |

## Costs

Free for a normal shop. Cloudflare's free plan covers the Worker, storage and cron. The Shopify
and Webflow APIs are included in your plans. The real limit is usually your Webflow plan's number
of CMS items. Details: [costs on free tiers](docs/advanced.md#costs-on-free-tiers).

---

**More:** how it works, the full field mapping, the Node CLI (for hosts other than Cloudflare),
manual deploys and limits are in [docs/advanced.md](docs/advanced.md).
