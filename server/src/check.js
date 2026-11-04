/**
 * Guided first-run check: says exactly what's missing and how to fix it.
 * Used by `tether-sync check` and the Worker's GET /check. Never returns secret values.
 *
 *   const report = await runCheck(config, env, { deep: true });
 *   report.ok, report.steps -> [{ level: 'ok' | 'warn' | 'error', title, message, fix }]
 */
import { normalizeConfig, cleanEnv, applyEnv, checkMapping, mapProduct, envProblems, MIN_SYNC_SECRET } from './mapping.js';
import { createShopify } from './shopify.js';
import { createWebflow } from './webflow.js';

export async function runCheck(rawConfig, rawEnv, { deep = true, fetch, sleep, worker = false } = {}) {
  const steps = [];
  const step = (level, title, message, fix) => { steps.push({ level, title, message, ...(fix ? { fix } : {}) }); return level !== 'error'; };
  const env = cleanEnv(rawEnv);
  // Filled in, but ignored: say so, or "missing" below would be confusing.
  envProblems(rawEnv).forEach(({ key, reason }) => {
    if (reason === 'placeholder') step('error', key, 'still has an example value, so it counts as not set.', `Replace it with the real value (or leave it empty if you don't use it).`);
    else if (reason === 'too-short') step('error', key, `is shorter than ${MIN_SYNC_SECRET} characters, so it counts as not set.`, `Use a random string of at least ${MIN_SYNC_SECRET} characters, e.g. from a password manager.`);
  });
  const done = (extra = {}) => ({ ok: !steps.some((s) => s.level === 'error'), steps, ...extra });

  let config;
  try {
    config = normalizeConfig(applyEnv(rawConfig, env));
  } catch (err) {
    step('error', 'Config', err.message, err.code === 'FIELD_MAP' ? 'Fix FIELD_MAP, or set it to "none".' : 'Fix tether-sync.config.js.');
    return done();
  }

  // 1. Presence (no network).
  if (!/^\d{4}-(01|04|07|10)$/.test(config.shopify.apiVersion || '')) {
    step('error', 'Shopify API version', `"${config.shopify.apiVersion}" isn't a dated quarterly version.`, 'Pin a version like 2026-07 (never "unstable": it changes without notice).');
  }
  const domain = config.shopify.domain;
  const domainOk = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain || '');
  if (!domain) step('error', 'Shopify store', 'No store domain.', 'Set SHOPIFY_DOMAIN to your-store.myshopify.com (not your custom domain).');
  else if (!domainOk) step('error', 'Shopify store', `"${domain}" isn't a .myshopify.com domain.`, 'Use the your-store.myshopify.com domain from Shopify admin → Settings → Domains.');
  else step('ok', 'Shopify store', domain);

  const auth = env.SHOPIFY_ADMIN_TOKEN ? 'admin token' : env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET ? 'client credentials' : null;
  if (!auth) {
    const half = env.SHOPIFY_CLIENT_ID || env.SHOPIFY_CLIENT_SECRET;
    step('error', 'Shopify access', half ? 'Only one of SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET is set.' : 'No Shopify credentials.',
      'Create an app in the Shopify Dev Dashboard with the read_products scope, install it on the store, and set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN for an existing custom app).');
  } else step('ok', 'Shopify access', `using ${auth}`);

  if (!env.WEBFLOW_TOKEN) step('error', 'Webflow token', 'WEBFLOW_TOKEN is missing.', 'Webflow → Site settings → Apps & integrations → API access → generate a token with CMS read and write.');
  else step('ok', 'Webflow token', 'set');

  const collectionId = config.webflow.collectionId;
  if (!collectionId) step('error', 'Webflow collection', 'No collection id.', 'Set WEBFLOW_COLLECTION_ID (Webflow CMS → collection settings, or GET /v2/sites/{site_id}/collections).');
  else if (!/^[a-f0-9]{24}$/i.test(collectionId)) step('warn', 'Webflow collection', `"${collectionId}" doesn't look like a Webflow id (24 hex characters).`, 'Copy the collection id, not its name or slug.');
  else step('ok', 'Webflow collection', collectionId);

  const webhookSecret = env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_CLIENT_SECRET;
  if (!webhookSecret) step('warn', 'Webhooks', 'No webhook secret: webhooks will be rejected, only the cron reconcile syncs.', 'Set SHOPIFY_WEBHOOK_SECRET (Settings → Notifications → Webhooks shows it), or use a Dev Dashboard app (its client secret is used).');
  else step('ok', 'Webhooks', env.SHOPIFY_WEBHOOK_SECRET ? 'SHOPIFY_WEBHOOK_SECRET set' : 'verified with the app client secret');

  if (worker && !env.SYNC_SECRET && !envProblems(rawEnv).some((p) => p.key === 'SYNC_SECRET')) {
    step('warn', 'SYNC_SECRET', 'not set: /check can only show what is configured, and POST /reconcile is off.', `Set a random string of at least ${MIN_SYNC_SECRET} characters to test the APIs from /check.`);
  }

  if (!deep || !domainOk || !auth || !env.WEBFLOW_TOKEN || !collectionId) {
    if (deep) step('error', 'Connections', 'Not tested: fix the items above first.');
    return done({ config: summary(config) });
  }

  // 2. Connections.
  const opts = { ...(fetch ? { fetch } : {}), ...(sleep ? { sleep } : {}) };
  const shopify = createShopify({
    domain, adminToken: env.SHOPIFY_ADMIN_TOKEN, clientId: env.SHOPIFY_CLIENT_ID, clientSecret: env.SHOPIFY_CLIENT_SECRET,
    apiVersion: config.shopify.apiVersion, metafields: config.shopify.metafields, inventory: config.shopify.inventory, retries: 0, ...opts,
  });
  let sample = null;
  try {
    const shop = await shopify.shopName();
    step('ok', 'Shopify API', `${shop.name} (API ${config.shopify.apiVersion})`);
    try {
      const { products } = await shopify.listProducts({ first: 1 });
      [sample] = products;
      step(sample ? 'ok' : 'warn', 'Shopify products', sample ? `can read products (e.g. "${sample.handle}")` : 'The store has no products yet.');
    } catch (err) {
      step('error', 'Shopify products', err.message, /access|scope|denied/i.test(err.message)
        ? 'Add the read_products scope to the app (and read_inventory if you map inventory), then reinstall/update it.'
        : 'Check the metafields in the mapping exist, and the API version.');
    }
  } catch (err) {
    const fix = err.status === 401 || /token request failed \((400|401)/.test(err.message)
      ? 'The credentials were rejected: check them, and that the app is installed on this store (client credentials only work for your own organization).'
      : err.status === 404 ? 'Store or API version not found: check SHOPIFY_DOMAIN and shopify.apiVersion.'
        : err.status === 403 ? 'The app lacks access: add read_products and reinstall.' : 'Check the domain and your network.';
    step('error', 'Shopify API', err.message, fix);
  }

  const webflow = createWebflow({ token: env.WEBFLOW_TOKEN, collectionId, perMinute: 0, retries: 0, ...opts });
  try {
    const col = await webflow.getCollection();
    step('ok', 'Webflow API', `collection "${col.displayName}" (${col.fields?.length || 0} fields)`);
    const problems = checkMapping(config, col);
    problems.forEach((p) => step(p.level, 'Field mapping', p.message, p.fix));
    if (!problems.some((p) => p.level === 'error')) step('ok', 'Field mapping', problems.length ? 'usable (see warnings)' : 'every mapped field exists');
    if (sample) {
      const existing = new Set((col.fields || []).map((f) => f.slug));
      const fd = mapProduct(sample, config);
      const written = Object.fromEntries(Object.entries(fd).filter(([k]) => !config.webflow.skipMissingFields || k === 'name' || k === 'slug' || existing.has(k)));
      steps.push({ level: 'info', title: 'Sample', message: `"${sample.handle}" would be written as`, sample: written });
    }
  } catch (err) {
    const fix = err.status === 401 ? 'WEBFLOW_TOKEN was rejected: generate a new site token.'
      : err.status === 403 ? 'The token lacks CMS access: generate one with CMS read and write.'
        : err.status === 404 ? 'Collection not found: check WEBFLOW_COLLECTION_ID, and that the token belongs to the same site.' : 'Check your network.';
    step('error', 'Webflow API', err.message, fix);
  }

  return done({ config: summary(config) });
}

const summary = (c) => ({
  shopify: { domain: c.shopify.domain, apiVersion: c.shopify.apiVersion, metafields: c.shopify.metafields },
  webflow: { collectionId: c.webflow.collectionId, publish: c.webflow.publish, skipMissingFields: c.webflow.skipMissingFields },
  fields: Object.fromEntries(Object.entries(c.fields).map(([k, v]) => [k, typeof v === 'function' ? '(function)' : v])),
  webflowOwned: c.webflowOwned,
});

/** Human-readable lines for the CLI. */
export function formatCheck(report) {
  const icon = { ok: '✓', warn: '!', error: '✗', info: '·' };
  const lines = [];
  report.steps.forEach((s) => {
    lines.push(`${icon[s.level] || '-'} ${s.title}: ${s.message}`);
    if (s.fix) lines.push(`    fix: ${s.fix}`);
    if (s.sample) lines.push(JSON.stringify(s.sample, null, 2).split('\n').map((l) => `    ${l}`).join('\n'));
  });
  const errors = report.steps.filter((s) => s.level === 'error').length;
  lines.push('', errors ? `${errors} thing(s) to fix before syncing.` : 'Ready: run `tether-sync import` (or wait for the first cron run).');
  return lines.join('\n');
}
