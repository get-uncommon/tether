#!/usr/bin/env node
// @ts-nocheck
/**
 * tether-sync: Shopify -> Webflow CMS.
 *
 *   tether-sync check                      guided first run: what's missing and how to fix it
 *   tether-sync import [--prune] [--force] every product (first run)
 *   tether-sync reconcile [--since ISO]    products changed since the last run (cron)
 *   tether-sync serve [--port 8787] [--host 127.0.0.1]   webhook endpoint
 *   tether-sync sync <handle|id>           one product
 *   tether-sync webhooks <public-url>      register the product webhooks (Node hosts)
 *
 * Options: --config path, --state path (default .tether-sync-state.json), --dry-run, --max N
 * Secrets from the environment (or a .env file next to the config).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createApp } from '../src/app.js';
import { runCheck, formatCheck } from '../src/check.js';
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

const HELP = `tether-sync <check|import|reconcile|serve|sync|webhooks> [options]
  --config <file>   tether-sync.config.js (default: ./tether-sync.config.{js,mjs,json})
  --state <file>    state file (default: .tether-sync-state.json next to the config)
  --dry-run         show what would change, write nothing
  --offline         (check) only check what's configured, don't call the APIs
  --json            (check) machine-readable report
  --prune           (import) archive/delete Webflow items whose product is gone
  --force           (import) rewrite every item even if unchanged
  --max <n>         (reconcile) max Webflow writes this run (default from config)
  --since <iso>     (reconcile) start from this time instead of the stored cursor
  --port <n>        (serve) default 8787
  --host <addr>     (serve) interface to listen on (default: all; 127.0.0.1 behind a proxy)
Env: WEBFLOW_TOKEN, SHOPIFY_ADMIN_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET, SHOPIFY_WEBHOOK_SECRET`;

async function main() {
  if (!cmd || flag('help') || cmd === 'help') { console.log(HELP); return 0; }
  const { path, config } = await loadConfig(opt('config'));
  const envFile = join(dirname(path), '.env');
  if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
  log.debug(`config: ${path}`);

  if (cmd === 'check') {
    const report = await runCheck(config, process.env, { deep: !flag('offline') });
    console.log(flag('json') ? JSON.stringify(report, null, 2) : formatCheck(report));
    return report.ok ? 0 : 1;
  }

  const store = fileStore(opt('state', join(dirname(path), '.tether-sync-state.json')));
  storeRef = store;
  const dryRun = flag('dry-run');
  let app;
  try { app = createApp(config, process.env, { store, log, dryRun }); } catch (err) {
    log.error(`${err.message}\nRun \`tether-sync check\` to see everything that's missing.`);
    return 1;
  }
  const { sync, shopify, webflow } = app;
  if (dryRun) log.info('dry run: nothing is written');

  switch (cmd) {
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
      log.info(`reconcile ${r.since} -> ${r.until}: ${r.processed} checked, ${r.changes} written${r.complete ? '' : ` (stopped at the ${r.stopped} limit, continues next run)`}`, r.stats);
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
    case 'webhooks': {
      const base = argv[1];
      if (!base || !/^https:\/\//.test(base)) { log.error('usage: tether-sync webhooks https://your-host (where `serve` is reachable)'); return 2; }
      const { ensureWebhooks } = await import('../src/webhooks.js');
      const r = await ensureWebhooks({ shopify, store, uri: `${base.replace(/\/$/, '')}/webhooks/shopify`, force: true });
      log.info(r.created.length ? `registered ${r.created.join(', ')}` : 'already registered', `-> ${r.uri}`);
      if (r.others?.length) log.warn(`also registered for other URLs: ${r.others.join(', ')}`);
      return 0;
    }
    case 'serve':
      await serve(app, { port: parseInt(opt('port', process.env.PORT || '8787'), 10), host: opt('host', process.env.HOST) || undefined, log });
      return null;
    default:
      console.log(HELP);
      return 2;
  }
}

let storeRef = null;
const flushState = () => storeRef?.flush?.().catch((err) => console.error(`state not saved: ${err.message}`));
main().then(async (code) => { await flushState(); if (code !== null) process.exit(code); }, async (err) => { await flushState(); console.error(err.message); process.exit(1); });
process.on('SIGINT', async () => { await flushState(); process.exit(130); });
