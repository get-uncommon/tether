/**
 * The Cloudflare Worker: customer accounts, the Shopify webhook endpoint, the setup check and the cron reconcile.
 *
 *   import config from './tether-sync.config.js';
 *   import { createWorker } from '../src/worker.ts';
 *   export default createWorker(config);
 *
 * Routes:
 *   /_tether/account/*          customer accounts (account.ts)
 *   POST /webhooks/shopify      Shopify product webhooks
 *   POST /reconcile             a manual run (Authorization: Bearer SYNC_SECRET); ?since=all imports everything and
 *                               registers this Worker's product webhooks
 *   GET  /health                `{ ok: true }`, for uptime checks
 *   GET  /check, GET /          which settings are set; with the bearer secret also the version, the API tests and
 *                               the details
 *
 * Bindings and secrets: `server/README.md`.
 */
import { createApp } from './app.ts';
import { kvStore, memoryStore } from './store.ts';
import { handleShopifyWebhook } from './webhook.ts';
import { bearerMatches } from './hmac.ts';
import { runCheck } from './check.ts';
import { cleanEnv, kvBinding } from './env.ts';
import { ensureWebhooks } from './webhooks.ts';
import { VERSION } from './version.ts';
import { messageOf } from './shared/error-message.ts';
import { handleAccount } from './account.ts';
import type { RawConfig } from './mapping.ts';
import type { Store } from './store.ts';
import type { DeliveryCache } from './webhook.ts';

type WorkerEnv = Record<string, unknown>;
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
type Fetch = typeof fetch;
type Sleep = (ms: number) => Promise<void>;

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

/** A fetch that counts its requests, so the sync can stop before Cloudflare's subrequest limit and resume next run. */
function countingFetch(inner: Fetch | undefined, limit: number) {
  let used = 0;
  const counted: Fetch = (input, init) => {
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
 */
function publicReport(report: Awaited<ReturnType<typeof runCheck>>) {
  const steps = report.steps.map(({ level, title }) => ({ level, title }));
  steps.push({ level: 'info', title: 'Send `Authorization: Bearer <SYNC_SECRET>` for details and the API tests' });
  return { ok: report.ok, steps };
}

interface WorkerSetup {
  config: RawConfig;
  fetch: Fetch | undefined;
  sleep: Sleep | undefined;
}

function appFor({ config, fetch, sleep }: WorkerSetup, env: WorkerEnv, store: Store, mode: 'job' | 'webhook' = 'job') {
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
function authorized(request: Request, env: WorkerEnv): Promise<boolean> {
  return bearerMatches(request.headers.get('authorization'), cleanEnv(env).SYNC_SECRET ?? '');
}

async function check(setup: WorkerSetup, request: Request, env: WorkerEnv, url: URL): Promise<Response> {
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

/**
 * The Cache API cache that remembers accepted webhook deliveries for every isolate of the data centre. It stores
 * something only on the shop's own zone (a custom domain or a route); on `*.workers.dev` it opens but stays empty.
 */
const DELIVERY_CACHE = 'tether-webhook-deliveries';

/**
 * @returns `null` where the runtime has no Cache API (Node runs this Worker in the tests), or when it can't be opened,
 *   which is logged: the isolate's own ids still drop repeats.
 */
async function openDeliveryCache(): Promise<DeliveryCache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(DELIVERY_CACHE);
  } catch (error) {
    console.warn(`webhook: the delivery cache is not available (${messageOf(error)})`);
    return null;
  }
}

async function webhook(
  setup: WorkerSetup,
  request: Request,
  env: WorkerEnv,
  context: ExecutionContext,
): Promise<Response> {
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

async function reconcile(setup: WorkerSetup, request: Request, env: WorkerEnv, url: URL): Promise<Response> {
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
  let webhooks: Awaited<ReturnType<typeof ensureWebhooks>> | { error: string };
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

async function scheduledReconcile(setup: WorkerSetup, env: WorkerEnv) {
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

export function createWorker(config: RawConfig, { fetch, sleep }: { fetch?: Fetch; sleep?: Sleep } = {}) {
  const setup: WorkerSetup = { config, fetch, sleep };
  return {
    async fetch(request: Request, env: WorkerEnv, context: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      try {
        const account = await handleAccount(request, env, fetch ? { fetch } : {});
        if (account) return account;
        if (url.pathname === '/health') return Response.json({ ok: true });
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
     */
    async scheduled(_event: unknown, env: WorkerEnv, context: ExecutionContext) {
      const run = scheduledReconcile(setup, env);
      context.waitUntil(run);
      return run;
    },
  };
}
