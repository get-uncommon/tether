#!/usr/bin/env node
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
import { createApp } from '../src/app.ts';
import { runCheck, formatCheck } from '../src/check.ts';
import { fileStore, loadConfig, serve } from '../src/node.ts';
import { messageOf } from '../src/shared/error-message.ts';

import type { App } from '../src/app.ts';
import type { FileStore } from '../src/node.ts';
import type { Logger } from '../src/util.ts';

/** Exit codes: 2 is a usage error; `null` keeps the process running (serve). */
const EXIT_USAGE = 2;
const EXIT_INTERRUPTED = 130;
const DEFAULT_PORT = '8787';

const argv = process.argv.slice(2);
const [command] = argv;
const flag = (name: string) => argv.includes(`--${name}`);
/** The value after `--name`, or `undefined` when the option or its value is missing. */
const option = (name: string) => {
  const index = argv.indexOf(`--${name}`);
  const value = index > -1 ? argv[index + 1] : undefined;
  return value || undefined;
};

/**
 * A positive whole number from the command line.
 *
 * @throws {Error} When it is anything else.
 */
function wholeNumber(name: string, text: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a whole number (got "${text}")`);
  return value;
}

const verbose = flag('verbose');
const log: Logger = {
  info: (...args) => {
    console.log(...args);
  },
  warn: (...args) => {
    console.warn('warn:', ...args);
  },
  error: (...args) => {
    console.error('error:', ...args);
  },
  debug: (...args) => {
    if (verbose) console.log(...args);
  },
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

async function runImport({ sync, webflow }: App): Promise<number> {
  const result = await sync.importAll({
    prune: flag('prune'),
    force: flag('force'),
    onProgress: (count, product) => {
      log.debug?.(`${String(count)} ${product.handle}`);
    },
  });
  const pruned = result.pruned.length ? `pruned ${String(result.pruned.length)}` : '';
  log.info(`import: ${String(result.products)} products`, result.stats, pruned);
  for (const failure of result.failures) log.error(`${failure.handle}: ${failure.error}`);
  log.info(`Webflow requests: ${String(webflow.requests)}`);
  return result.failures.length ? 1 : 0;
}

async function runReconcile({ sync }: App): Promise<number> {
  const max = option('max');
  const since = option('since');
  const result = await sync.reconcile({
    ...(max === undefined ? {} : { maxChanges: wholeNumber('max', max) }),
    ...(since === undefined ? {} : { since }),
  });
  const stopped = result.complete ? '' : ` (stopped at the ${String(result.stopped)} limit, continues next run)`;
  log.info(
    `reconcile ${result.since} -> ${result.until}: ${String(result.processed)} checked, ${String(result.changes)} written${stopped}`,
    result.stats,
  );
  for (const failure of result.failures) log.error(`product ${String(failure.id)}: ${failure.error}`);
  return result.failures.length ? 1 : 0;
}

async function runSyncOne({ sync, shopify }: App): Promise<number> {
  const key = argv[1];
  if (!key) {
    log.error('usage: tether-sync sync <handle|id>');
    return EXIT_USAGE;
  }
  let id = key;
  if (!/^\d+$|^gid:/.test(key)) {
    const {
      products: [product],
    } = await shopify.listProducts({ first: 1, query: `handle:${JSON.stringify(key)}` });
    if (!product) {
      log.error(`no product with handle ${key}`);
      return 1;
    }
    id = product.id;
  }
  const result = await sync.syncById(id);
  log.info(result.action, result.itemId ?? '', result.reason ?? '');
  return 0;
}

async function runWebhooks({ shopify }: App, store: FileStore): Promise<number> {
  const base = argv[1];
  if (!base?.startsWith('https://')) {
    log.error('usage: tether-sync webhooks https://your-host (where `serve` is reachable)');
    return EXIT_USAGE;
  }
  const { ensureWebhooks } = await import('../src/webhooks.ts');
  const result = await ensureWebhooks({
    shopify,
    store,
    uri: `${base.replace(/\/$/, '')}/webhooks/shopify`,
    force: true,
  });
  const created = result.created.length ? `registered ${result.created.join(', ')}` : 'already registered';
  log.info(created, `-> ${result.uri}`);
  if (result.others?.length) log.warn(`also registered for other URLs: ${result.others.join(', ')}`);
  return 0;
}

async function runServe(app: App): Promise<null> {
  await serve(app, {
    port: wholeNumber('port', option('port') ?? (process.env['PORT'] || DEFAULT_PORT)),
    host: option('host') ?? (process.env['HOST'] || undefined),
    log,
  });
  return null;
}

let stateStore: FileStore | null = null;

/**
 * Runs the command.
 *
 * @returns The exit code, or `null` while `serve` keeps running.
 */
async function main(): Promise<number | null> {
  if (!command || flag('help') || command === 'help') {
    console.log(HELP);
    return 0;
  }
  const { path, config } = await loadConfig(option('config'));
  const envFile = join(dirname(path), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  log.debug?.(`config: ${path}`);

  if (command === 'check') {
    const report = await runCheck(config, process.env, { deep: !flag('offline') });
    console.log(flag('json') ? JSON.stringify(report, null, 2) : formatCheck(report));
    return report.ok ? 0 : 1;
  }

  const store = fileStore(option('state') ?? join(dirname(path), '.tether-sync-state.json'), { log });
  stateStore = store;
  const dryRun = flag('dry-run');
  let app: App;
  try {
    app = createApp(config, process.env, { store, log, dryRun });
  } catch (err) {
    log.error(`${messageOf(err)}\nRun \`tether-sync check\` to see everything that's missing.`);
    return 1;
  }
  if (dryRun) log.info('dry run: nothing is written');

  switch (command) {
    case 'import':
      return runImport(app);
    case 'reconcile':
      return runReconcile(app);
    case 'sync':
      return runSyncOne(app);
    case 'webhooks':
      return runWebhooks(app, store);
    case 'serve':
      return runServe(app);
    default:
      console.log(HELP);
      return EXIT_USAGE;
  }
}

/** Writes what the state file store still holds; a failure is reported, the exit goes ahead. */
async function flushState() {
  try {
    await stateStore?.flush();
  } catch (err) {
    console.error(`state not saved: ${messageOf(err)}`);
  }
}

void main().then(
  async (code) => {
    await flushState();
    if (code !== null) process.exit(code);
  },
  async (err: unknown) => {
    await flushState();
    console.error(messageOf(err));
    process.exit(1);
  },
);
process.on('SIGINT', () => {
  void flushState().then(() => process.exit(EXIT_INTERRUPTED));
});
