// @ts-nocheck
/**
 * Cloudflare Worker: webhook endpoint + cron reconcile.
 *
 *   import config from './tether-sync.config.js';
 *   import { createWorker } from '../src/worker.js';
 *   export default createWorker(config);
 *
 * Bindings: KV namespace TETHER_SYNC. Secrets: WEBFLOW_TOKEN, SHOPIFY_ADMIN_TOKEN (or
 * SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET), SHOPIFY_WEBHOOK_SECRET, optional SYNC_SECRET.
 *
 * Routes:
 *   POST /webhooks/shopify      Shopify product webhooks
 *   POST /reconcile             manual run (Authorization: Bearer SYNC_SECRET); ?since=all imports everything.
 *                               Also registers this Worker's Shopify product webhooks (once).
 *   GET  /health
 *   GET  /check                 what's configured (with Bearer SYNC_SECRET: also tests the APIs)
 */
import { createApp } from './app.js';
import { kvStore, memoryStore } from './store.js';
import { handleShopifyWebhook } from './webhook.js';
import { safeEqual } from './hmac.js';
import { runCheck } from './check.js';
import { cleanEnv } from './env.js';
import { ensureWebhooks } from './webhooks.js';
import { VERSION } from './version.js';
import { handleAccount } from './account.js';

const consoleLog = {
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
  debug() {},
};

/**
 * Counts outgoing requests per invocation. Free plan: 50 subrequests (MAX_SUBREQUESTS, default 45
 * to leave room); paid plans can raise it. The sync stops early and resumes next run.
 */
function countingFetch(inner, limit) {
  let used = 0;
  const f = (...args) => {
    used++;
    return (inner || globalThis.fetch)(...args);
  };
  return {
    fetch: f,
    budget: {
      left: () => limit - used,
      get used() {
        return used;
      },
    },
  };
}

export function createWorker(config, { fetch, sleep } = {}) {
  const make = (env, mode = 'job') => {
    const store = env.TETHER_SYNC ? kvStore(env.TETHER_SYNC) : memoryStore();
    const limit = parseInt(cleanEnv(env).MAX_SUBREQUESTS || '45', 10) || 45;
    const counted = countingFetch(fetch, limit);
    return createApp(config, env, {
      store,
      fetch: counted.fetch,
      budget: counted.budget,
      sleep,
      log: consoleLog,
      mode,
    });
  };
  const secretOk = (request, env) => {
    const secret = cleanEnv(env).SYNC_SECRET; // empty, 'none', an example value or < 24 chars: unset
    return Boolean(secret) && safeEqual(request.headers.get('authorization') || '', `Bearer ${secret}`);
  };

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      try {
        // Customer accounts (/_tether/account/*): the browser never holds a Shopify token.
        const account = await handleAccount(request, env, { fetch });
        if (account) return account;

        if (url.pathname === '/health')
          return Response.json({ ok: true, version: VERSION, kv: Boolean(env.TETHER_SYNC) });

        if (url.pathname === '/check' || url.pathname === '/') {
          const deep = secretOk(request, env);
          const report = await runCheck(config, env, {
            deep,
            fetch,
            sleep,
            worker: true,
            webhookUri: `${url.origin}/webhooks/shopify`,
            version: deep ? VERSION : null,
            range: cleanEnv(env).TETHER_VERSION || null,
          });
          if (!deep) {
            // Anyone can open this URL: say what's set, never the values (store, collection id).
            report.steps = report.steps.map((s) => (s.level === 'ok' ? { ...s, message: 'set' } : s));
            report.steps.push({
              level: 'info',
              title: 'Connections',
              message: 'Send `Authorization: Bearer <SYNC_SECRET>` to also test the Shopify and Webflow APIs.',
            });
            delete report.config;
          }
          return Response.json(
            { version: VERSION, ...report, kv: Boolean(env.TETHER_SYNC) },
            { status: report.ok ? 200 : 503 },
          );
        }

        if (url.pathname === '/webhooks/shopify') {
          const app = make(env, 'webhook');
          const { response, task } = await handleShopifyWebhook(request, {
            sync: app.sync,
            secret: app.webhookSecret,
            secrets: app.webhookSecrets,
            shopDomain: app.config.shopify.domain,
            log: consoleLog,
            sleep,
          });
          if (task) ctx.waitUntil(task);
          return response;
        }

        if (url.pathname === '/reconcile' && request.method === 'POST') {
          if (!secretOk(request, env)) return new Response('unauthorized', { status: 401 });
          // ?since=all (or an ISO date): a full first import without the CLI. If it doesn't fit
          // in one run, the cron continues it.
          const raw = url.searchParams.get('since');
          const since = raw === 'all' ? '2000-01-01T00:00:00Z' : raw;
          if (since && Number.isNaN(Date.parse(since)))
            return new Response('since must be "all" or an ISO date', { status: 400 });
          const app = make(env);
          // First run: register this Worker's product webhooks through the app (once).
          let webhooks;
          try {
            webhooks = await ensureWebhooks({
              shopify: app.shopify,
              store: app.store,
              uri: `${url.origin}/webhooks/shopify`,
            });
          } catch (err) {
            webhooks = { error: err.message };
          }
          const result = await app.sync.reconcile(since ? { since } : {});
          return Response.json({ ...result, webhooks });
        }
        return new Response('not found', { status: 404 });
      } catch (err) {
        console.error(err);
        return new Response('error', { status: 500 });
      }
    },

    async scheduled(event, env, ctx) {
      const run = make(env)
        .sync.reconcile()
        .then((r) => {
          console.log(
            `reconcile: ${r.processed} checked, ${r.changes} written, complete=${r.complete}${r.stopped ? ` (stopped: ${r.stopped})` : ''}`,
          );
          return r;
        });
      ctx.waitUntil(run);
      return run;
    },
  };
}
