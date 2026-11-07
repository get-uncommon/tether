- Fix (sync Worker): `/check` counts a deploy-only Worker's (`DEPLOY_HOOK_URL` without Webflow)
  reconcile run's KV operations with its changes: a deploy-only change makes no request, so up to
  `reconcile.maxChangesPerRun` products each write twice besides the products the subrequests bound.
  Before, it counted those writes only for products that sent a request, so with `maxChangesPerRun`
  and `maxProductsPerRun` at 400 it said 733 KV operations while a run could pass Cloudflare's 1,000
  and fail, and `/check` gave no warning. With the default settings a deploy-only run uses at most
  573 KV operations, a Webflow run still 533.
