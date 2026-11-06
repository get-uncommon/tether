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
import { cleanEnv, kvBinding } from './env.js';
import { ensureWebhooks } from './webhooks.js';
import { VERSION } from './version.js';
import { messageOf } from './util.js';
import { handleAccount } from './account.js';

/** @typedef {Record<string, unknown>} WorkerEnv */
/** @typedef {{ waitUntil(promise: Promise<unknown>): void }} ExecutionContext */
/** @typedef {Parameters<typeof createApp>[0]} SyncConfig */
/** @typedef {typeof fetch} Fetch */
/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./webhook.js').DeliveryCache} DeliveryCache */

const consoleLog = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug() {
    // Debug output is for the Node CLI's --verbose.
  },
};

/**
 * Without its KV namespace the sync forgets its cursor and hashes after every invocation, so each run starts over and
 * rewrites what didn't change.
 */
const MISSING_KV =
  'the TETHER_SYNC KV namespace is not bound: the sync keeps nothing between runs. Add it in Cloudflare → your Worker → Bindings, as in wrangler.jsonc';

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

/**
 * What anyone may see of the setup check without the bearer secret: each step's title and level, never its message,
 * fix or sample, because those name the store, the collection and the site. The version and the KV binding are left
 * out too: they tell a stranger which release to probe.
 *
 * @param {Awaited<ReturnType<typeof runCheck>>} report
 */
function publicReport(report) {
  const steps = report.steps.map(({ level, title }) => ({ level, title }));
  steps.push({ level: 'info', title: 'Send `Authorization: Bearer <SYNC_SECRET>` for details and the API tests' });
  return { ok: report.ok, steps };
}

/** @typedef {{ config: SyncConfig, fetch: Fetch | undefined, sleep: ((ms: number) => Promise<void>) | undefined }} WorkerSetup */

/**
 * @param {WorkerSetup} setup
 * @param {WorkerEnv} env
 * @param {Store} store
 * @param {'job' | 'webhook'} [mode]
 */
function appFor({ config, fetch, sleep }, env, store, mode = 'job') {
  const limit = parseInt(cleanEnv(env).MAX_SUBREQUESTS ?? '', 10) || DEFAULT_MAX_SUBREQUESTS;
  const counted = countingFetch(fetch, limit);
  return createApp(config, env, {
    store,
    fetch: counted.fetch,
    budget: counted.budget,
    sleep,
    log: consoleLog,
    mode,
  });
}
/** @param {Request} request @param {WorkerEnv} env */
function authorized(request, env) {
  return bearerMatches(request.headers.get('authorization'), cleanEnv(env).SYNC_SECRET ?? '');
}

/** @param {WorkerSetup} setup @param {Request} request @param {WorkerEnv} env @param {URL} url */
async function check(setup, request, env, url) {
  const { config, fetch, sleep } = setup;
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
  const body = deep ? { version: VERSION, ...report, kv: kvBinding(env) !== null } : publicReport(report);
  return Response.json(body, { status: report.ok ? 200 : 503 });
}

/** The Cache API cache that remembers accepted webhook deliveries for every isolate of the data centre. */
const DELIVERY_CACHE = 'tether-webhook-deliveries';

/**
 * @returns {Promise<DeliveryCache | null>} `null` where the runtime has no Cache API (Node runs this Worker in the
 *   tests), or when it can't be opened, which is logged: the isolate's own ids still drop repeats.
 */
async function openDeliveryCache() {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(DELIVERY_CACHE);
  } catch (error) {
    console.warn(`webhook: the delivery cache is not available (${messageOf(error)})`);
    return null;
  }
}

/** @param {WorkerSetup} setup @param {Request} request @param {WorkerEnv} env @param {ExecutionContext} context */
async function webhook(setup, request, env, context) {
  const { sleep } = setup;
  const namespace = kvBinding(env);
  // A webhook is still synced without the namespace, only without its stored hash: answering with an error would make
  // Shopify retry it and, after enough failures, delete the subscription.
  if (!namespace) console.error(`webhook: ${MISSING_KV}`);
  const app = appFor(setup, env, namespace ? kvStore(namespace) : memoryStore(), 'webhook');
  const { response, task } = await handleShopifyWebhook(request, {
    sync: app.sync,
    secrets: app.webhookSecrets,
    shopDomain: app.config.shopify.domain,
    log: consoleLog,
    deliveries: await openDeliveryCache(),
    ...(sleep ? { sleep } : {}),
  });
  if (task) context.waitUntil(task);
  return response;
}

/** @param {WorkerSetup} setup @param {Request} request @param {WorkerEnv} env @param {URL} url */
async function reconcile(setup, request, env, url) {
  if (!(await authorized(request, env))) return new Response('unauthorized', { status: 401 });
  // ?since=all (or an ISO date) is a full first import without the CLI. What doesn't fit in one run, the cron
  // continues.
  const raw = url.searchParams.get('since');
  const since = raw === 'all' ? '2000-01-01T00:00:00Z' : raw;
  if (since && Number.isNaN(Date.parse(since))) {
    return new Response('since must be "all" or an ISO date', { status: 400 });
  }
  const namespace = kvBinding(env);
  if (!namespace) {
    console.error(`reconcile: ${MISSING_KV}`);
    return Response.json({ error: MISSING_KV }, { status: 503 });
  }
  const app = appFor(setup, env, kvStore(namespace));
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

/** @param {WorkerSetup} setup @param {WorkerEnv} env */
async function scheduledReconcile(setup, env) {
  try {
    const namespace = kvBinding(env);
    if (!namespace) throw new Error(MISSING_KV);
    const result = await appFor(setup, env, kvStore(namespace)).sync.reconcile({});
    const stopped = result.stopped ? ` (stopped: ${result.stopped})` : '';
    console.log(
      `reconcile: ${result.processed} checked, ${result.changes} written, complete=${String(result.complete)}${stopped}`,
    );
    // The run has stored its cursor and retries by now; a run Shopify's product list stopped is still a failed run.
    if (result.stopped === 'error') {
      const reasons = result.failures.filter((failure) => failure.id === null).map((failure) => failure.error);
      throw new Error(`listing products failed: ${reasons.join('; ')}`);
    }
    return result;
  } catch (error) {
    console.error('reconcile failed:', messageOf(error));
    throw error;
  }
}

/**
 * @param {SyncConfig} config
 * @param {{ fetch?: Fetch, sleep?: (ms: number) => Promise<void> }} [options]
 */
export function createWorker(config, { fetch, sleep } = {}) {
  /** @type {WorkerSetup} */
  const setup = { config, fetch, sleep };
  return {
    /** @param {Request} request @param {WorkerEnv} env @param {ExecutionContext} context */
    async fetch(request, env, context) {
      const url = new URL(request.url);
      try {
        const account = await handleAccount(request, env, fetch ? { fetch } : {});
        if (account) return account;
        // The version is documented here (server/README.md) for checking an update landed.
        if (url.pathname === '/health') return Response.json({ ok: true, version: VERSION });
        if (url.pathname === '/check' || url.pathname === '/') return await check(setup, request, env, url);
        if (url.pathname === '/webhooks/shopify') return await webhook(setup, request, env, context);
        if (url.pathname === '/reconcile' && request.method === 'POST')
          return await reconcile(setup, request, env, url);
        return new Response('not found', { status: 404 });
      } catch (error) {
        console.error(error);
        return new Response('error', { status: 500 });
      }
    },

    /**
     * The cron reconcile. A failure is logged and rethrown, so Cloudflare records the run as failed and the next cron
     * run starts again from the stored cursor.
     *
     * @param {unknown} _event @param {WorkerEnv} env @param {ExecutionContext} context
     */
    async scheduled(_event, env, context) {
      const run = scheduledReconcile(setup, env);
      context.waitUntil(run);
      return run;
    },
  };
}
