/**
 * The Cloudflare Worker: customer accounts, the Shopify webhook endpoint, the setup check and the cron reconcile.
 *
 *   import config from './tether-sync.config.js';
 *   import { createWorker } from '../src/worker.js';
 *   export default createWorker(config);
 *
 * Routes:
 *   /_tether/account/*          customer accounts (account.js)
 *   POST /webhooks/shopify      Shopify product webhooks
 *   POST /reconcile             a manual run (Authorization: Bearer SYNC_SECRET); ?since=all imports everything and
 *                               registers this Worker's product webhooks
 *   GET  /health
 *   GET  /check, GET /          which settings are set; with the bearer secret also the API tests and the details
 *
 * Bindings and secrets: `server/README.md`.
 */
import { createApp } from './app.js';
import { kvStore, memoryStore } from './store.js';
import { handleShopifyWebhook } from './webhook.js';
import { bearerMatches } from './hmac.js';
import { runCheck } from './check.js';
import { cleanEnv } from './env.js';
import { ensureWebhooks } from './webhooks.js';
import { VERSION } from './version.js';
import { handleAccount } from './account.js';

/** @typedef {Record<string, unknown>} WorkerEnv */
/** @typedef {{ waitUntil(promise: Promise<unknown>): void }} ExecutionContext */
/** @typedef {Parameters<typeof createApp>[0]} SyncConfig */
/** @typedef {typeof fetch} Fetch */

const consoleLog = {
  info: (/** @type {unknown[]} */ ...args) => {
    console.log(...args);
  },
  warn: (/** @type {unknown[]} */ ...args) => {
    console.warn(...args);
  },
  error: (/** @type {unknown[]} */ ...args) => {
    console.error(...args);
  },
  debug() {
    // Debug output is for the Node CLI's --verbose.
  },
};

/** Subrequests one invocation may make. Cloudflare's free plan allows 50; the rest is headroom. */
const DEFAULT_MAX_SUBREQUESTS = 45;

/**
 * A fetch that counts its requests, so the sync can stop before Cloudflare's subrequest limit and resume next run.
 *
 * @param {Fetch | undefined} inner
 * @param {number} limit
 */
function countingFetch(inner, limit) {
  let used = 0;
  /** @type {Fetch} */
  const counted = (input, init) => {
    used++;
    return (inner ?? globalThis.fetch)(input, init);
  };
  return {
    fetch: counted,
    budget: {
      left: () => limit - used,
      get used() {
        return used;
      },
    },
  };
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What anyone may see of the setup check without the bearer secret: each step's title and level, never its message,
 * fix or sample, because those name the store, the collection and the site.
 *
 * @param {Awaited<ReturnType<typeof runCheck>>} report
 */
function publicReport(report) {
  const steps = report.steps.map(({ level, title }) => ({ level, title }));
  steps.push({ level: 'info', title: 'Send `Authorization: Bearer <SYNC_SECRET>` for details and the API tests' });
  return { ok: report.ok, steps };
}

/**
 * @param {SyncConfig} config
 * @param {{ fetch?: Fetch, sleep?: (ms: number) => Promise<void> }} [options]
 */
export function createWorker(config, { fetch, sleep } = {}) {
  /** @param {WorkerEnv} env @param {'job' | 'webhook'} [mode] */
  const appFor = (env, mode = 'job') => {
    const namespace = /** @type {Parameters<typeof kvStore>[0] | undefined} */ (env['TETHER_SYNC']);
    const limit = parseInt(cleanEnv(env).MAX_SUBREQUESTS ?? '', 10) || DEFAULT_MAX_SUBREQUESTS;
    const counted = countingFetch(fetch, limit);
    return createApp(config, env, {
      store: namespace ? kvStore(namespace) : memoryStore(),
      fetch: counted.fetch,
      budget: counted.budget,
      sleep,
      log: consoleLog,
      mode,
    });
  };
  /** @param {Request} request @param {WorkerEnv} env */
  const authorized = (request, env) =>
    bearerMatches(request.headers.get('authorization'), cleanEnv(env).SYNC_SECRET ?? '');

  /** @param {Request} request @param {WorkerEnv} env @param {URL} url */
  async function check(request, env, url) {
    const deep = await authorized(request, env);
    const report = await runCheck(config, env, {
      deep,
      fetch,
      sleep,
      worker: true,
      webhookUri: `${url.origin}/webhooks/shopify`,
      version: deep ? VERSION : null,
      range: cleanEnv(env).TETHER_VERSION ?? null,
    });
    const body = deep ? report : publicReport(report);
    return Response.json(
      { version: VERSION, ...body, kv: Boolean(env['TETHER_SYNC']) },
      { status: report.ok ? 200 : 503 },
    );
  }

  /** @param {Request} request @param {WorkerEnv} env @param {ExecutionContext} context */
  async function webhook(request, env, context) {
    const app = appFor(env, 'webhook');
    const { response, task } = await handleShopifyWebhook(request, {
      sync: app.sync,
      secrets: app.webhookSecrets,
      shopDomain: app.config.shopify.domain,
      log: consoleLog,
      ...(sleep ? { sleep } : {}),
    });
    if (task) context.waitUntil(task);
    return response;
  }

  /** @param {Request} request @param {WorkerEnv} env @param {URL} url */
  async function reconcile(request, env, url) {
    if (!(await authorized(request, env))) return new Response('unauthorized', { status: 401 });
    // ?since=all (or an ISO date) is a full first import without the CLI. What doesn't fit in one run, the cron
    // continues.
    const raw = url.searchParams.get('since');
    const since = raw === 'all' ? '2000-01-01T00:00:00Z' : raw;
    if (since && Number.isNaN(Date.parse(since))) {
      return new Response('since must be "all" or an ISO date', { status: 400 });
    }
    const app = appFor(env);
    /** @type {Awaited<ReturnType<typeof ensureWebhooks>> | { error: string }} */
    let webhooks;
    try {
      webhooks = await ensureWebhooks({
        shopify: app.shopify,
        store: app.store,
        uri: `${url.origin}/webhooks/shopify`,
      });
    } catch (error) {
      console.error('webhook registration', messageOf(error));
      webhooks = { error: messageOf(error) };
    }
    const result = await app.sync.reconcile(since ? { since } : {});
    return Response.json({ ...result, webhooks });
  }

  return {
    /** @param {Request} request @param {WorkerEnv} env @param {ExecutionContext} context */
    async fetch(request, env, context) {
      const url = new URL(request.url);
      try {
        const account = await handleAccount(request, env, fetch ? { fetch } : {});
        if (account) return account;
        if (url.pathname === '/health') {
          return Response.json({ ok: true, version: VERSION, kv: Boolean(env['TETHER_SYNC']) });
        }
        if (url.pathname === '/check' || url.pathname === '/') return await check(request, env, url);
        if (url.pathname === '/webhooks/shopify') return await webhook(request, env, context);
        if (url.pathname === '/reconcile' && request.method === 'POST') return await reconcile(request, env, url);
        return new Response('not found', { status: 404 });
      } catch (error) {
        console.error(error);
        return new Response('error', { status: 500 });
      }
    },

    /** @param {unknown} _event @param {WorkerEnv} env @param {ExecutionContext} context */
    async scheduled(_event, env, context) {
      const run = appFor(env)
        .sync.reconcile({})
        .then((result) => {
          const stopped = result.stopped ? ` (stopped: ${result.stopped})` : '';
          console.log(
            `reconcile: ${result.processed} checked, ${result.changes} written, complete=${String(result.complete)}${stopped}`,
          );
          return result;
        });
      context.waitUntil(run);
      return run;
    },
  };
}
