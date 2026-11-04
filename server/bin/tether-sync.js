#!/usr/bin/env node
/**
 * tether-sync: Shopify -> Webflow CMS.
 *
 *   tether-sync check                      tokens, collection and mapping
 *   tether-sync import [--prune] [--force] every product (first run)
 *   tether-sync reconcile [--since ISO]    products changed since the last run (cron)
 *   tether-sync serve [--port 8787]        webhook endpoint
 *   tether-sync sync <handle|id>           one product
 *
 * Options: --config path, --state path (default .tether-sync-state.json), --dry-run, --max N
 * Secrets from the environment (or a .env file next to the config).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createApp } from '../src/app.js';
import { checkMapping, mapProduct } from '../src/mapping.js';
import { fileStore, loadConfig, serve } from '../src/node.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i > -1 && argv[i + 1] ? argv[i + 1] : def; };
const verbose = flag('verbose');
const log = {
  info: (...a) => console.log(...a), warn: (...a) => console.warn('warn:', ...a),
  error: (...a) => console.error('error:', ...a), debug: (...a) => { if (verbose) console.log(...a); },
};

const HELP = `tether-sync <check|import|reconcile|serve|sync> [options]
  --config <file>   tether-sync.config.js (default: ./tether-sync.config.{js,mjs,json})
  --state <file>    state file (default: .tether-sync-state.json next to the config)
  --dry-run         show what would change, write nothing
  --prune           (import) archive/delete Webflow items whose product is gone
  --force           (import) rewrite every item even if unchanged
  --max <n>         (reconcile) max Webflow writes this run (default from config)
  --since <iso>     (reconcile) start from this time instead of the stored cursor
  --port <n>        (serve) default 8787
Env: WEBFLOW_TOKEN, SHOPIFY_ADMIN_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET, SHOPIFY_WEBHOOK_SECRET`;

async function main() {
  if (!cmd || flag('help') || cmd === 'help') { console.log(HELP); return 0; }
  const { path, config } = await loadConfig(opt('config'));
  const envFile = join(dirname(path), '.env');
  if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
  const store = fileStore(opt('state', join(dirname(path), '.tether-sync-state.json')));
  const dryRun = flag('dry-run');
  const app = createApp(config, process.env, { store, log, dryRun });
  const { sync, shopify, webflow } = app;
  if (dryRun) log.info('dry run: nothing is written');

  switch (cmd) {
    case 'check': {
      let bad = 0;
      try { const s = await shopify.shopName(); log.info(`Shopify ok: ${s.name} (${s.myshopifyDomain}), API ${shopify.apiVersion}`); } catch (e) { bad++; log.error(`Shopify: ${e.message}`); }
      try {
        const col = await webflow.getCollection();
        log.info(`Webflow ok: collection "${col.displayName}" (${col.fields?.length} fields)`);
        const problems = checkMapping(app.config, col);
        problems.forEach((p) => log.warn(p));
        if (!problems.length) log.info('Mapping ok');
        bad += problems.length;
      } catch (e) { bad++; log.error(`Webflow: ${e.message}`); }
      try {
        const { products } = await shopify.listProducts({ first: 1 });
        if (products[0]) log.info('Sample mapping:', JSON.stringify(mapProduct(products[0], app.config), null, 2));
      } catch (e) { bad++; log.error(`Shopify products: ${e.message}`); }
      return bad ? 1 : 0;
    }
    case 'import': {
      const r = await sync.importAll({
        prune: flag('prune'), force: flag('force'),
        onProgress: (n, p) => log.debug(`${n} ${p.handle}`),
      });
      log.info(`import: ${r.products} products`, r.stats, r.pruned.length ? `pruned ${r.pruned.length}` : '');
      r.failures.forEach((f) => log.error(`${f.handle}: ${f.error}`));
      log.info(`Webflow requests: ${webflow.requests}`);
      return r.failures.length ? 1 : 0;
    }
    case 'reconcile': {
      const max = opt('max') ? parseInt(opt('max'), 10) : undefined;
      const r = await sync.reconcile({ maxChanges: max, since: opt('since') });
      log.info(`reconcile ${r.since} -> ${r.until}: ${r.processed} checked, ${r.changes} written${r.complete ? '' : ' (more next run)'}`, r.stats);
      r.failures.forEach((f) => log.error(`product ${f.id}: ${f.error}`));
      return r.failures.length ? 1 : 0;
    }
    case 'sync': {
      const key = argv[1];
      if (!key) { log.error('usage: tether-sync sync <handle|id>'); return 2; }
      let id = key;
      if (!/^\d+$|^gid:/.test(key)) {
        const { products } = await shopify.listProducts({ first: 1, query: `handle:${JSON.stringify(key)}` });
        if (!products[0]) { log.error(`no product with handle ${key}`); return 1; }
        id = products[0].id;
      }
      const r = await sync.syncById(id);
      log.info(r.action, r.itemId || '', r.reason || '');
      return 0;
    }
    case 'serve':
      await serve(app, { port: parseInt(opt('port', process.env.PORT || '8787'), 10), log });
      return null;
    default:
      console.log(HELP);
      return 2;
  }
}

main().then((code) => { if (code !== null) process.exit(code); }, (err) => { console.error(err.message); process.exit(1); });
