// The reconcile within Cloudflare's limits on one Worker invocation: the KV operations the retry inbox costs, and an
// item index too big for one run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, memoryStore, createWorker, kvStore, normalizeConfig } from '../src/index.ts';
import { KV_OPERATIONS_PER_INVOCATION, maxReconcileKvOperations } from '../src/reconcile.ts';
import { RETRY_INBOX_TTL_SECONDS } from '../src/sync-state.ts';
import { runCheck } from '../src/check.ts';
import {
  createMockApis,
  shopifyProduct,
  baseConfig,
  env,
  instantSleep,
  asList,
  parseJson,
  kvList,
  urlOf,
  checkStep,
  deliverWebhook,
} from './mocks.js';

/**
 * A KV namespace over a map of the JSON texts it holds. After `invocation()` it allows that Worker invocation 1,000
 * operations, as Cloudflare does, and throws Cloudflare's error past them.
 */
function kvNamespace() {
  /** @type {Map<string, string>} */
  const kv = new Map();
  /** @type {Map<string, number>} The `expirationTtl` each key was written with. */
  const ttls = new Map();
  let used = 0;
  let allowed = Infinity;
  const count = () => {
    used++;
    if (used > allowed) throw new Error('Too many API requests by single worker invocation.');
  };
  /** @type {import('../src/env.ts').KvBinding} */
  const TETHER_SYNC = {
    async get(key, type) {
      count();
      const value = kv.get(key);
      if (value == null) return null;
      return type === 'json' ? parseJson(value) : value;
    },
    async put(key, value, options) {
      count();
      kv.set(key, value);
      if (options) ttls.set(key, options.expirationTtl);
    },
    async delete(key) {
      count();
      kv.delete(key);
    },
    async list(options) {
      count();
      return kvList(() => kv.keys())(options);
    },
  };
  /** Starts counting a new invocation's operations. */
  const invocation = () => {
    used = 0;
    allowed = KV_OPERATIONS_PER_INVOCATION;
  };
  return { kv, ttls, TETHER_SYNC, invocation, used: () => used };
}

/** @param {number} count Hand-made Webflow items, none of them a product's. */
const handMadeItems = (count) =>
  Array.from({ length: count }, (_, i) => ({ id: `hand${i}`, fieldData: { name: `Hand ${i}`, slug: `hand-${i}` } }));

const INBOX = 'tether-sync:reconcile:retry:';

test('a product failing on every webhook is queued once until a reconcile takes it in, and expires in 30 days', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1, { handle: 'bad' })], failCreateFor: 'bad' });
  const { kv, ttls, TETHER_SYNC } = kvNamespace();
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const wenv = { ...env, TETHER_SYNC };
  const queued = () => [...kv.keys()].filter((key) => key.startsWith(INBOX));
  for (let webhook = 0; webhook < 5; webhook++) await deliverWebhook(worker, wenv, 'products/update', 1);
  assert.equal(queued().length, 1);
  assert.deepEqual([...ttls.values()], [RETRY_INBOX_TTL_SECONDS]);

  kv.set('tether-sync:reconcile:since', JSON.stringify('2026-12-01T00:00:00Z'));
  await worker.scheduled({}, wenv, { waitUntil() {} });
  assert.deepEqual(queued(), [], 'the reconcile took it in');
  await deliverWebhook(worker, wenv, 'products/update', 1);
  assert.equal(queued().length, 1, 'a failure after that is queued again');
});

test('a failed deletion is queued even while the product has a key queued', async () => {
  const store = memoryStore();
  const { sync } = createApp(baseConfig, env, { store, fetch: createMockApis().fetch, sleep: instantSleep });
  await sync.queueRetry('5', new Error('Webflow 503'));
  await sync.queueRetry('5', new Error('Webflow 503'));
  await sync.queueRetry('5', new Error('Webflow 503'), { deletion: true });
  assert.equal((await store.list('reconcile:retry:', 10)).length, 2);
});

test('an inbox of 3,000 queued failures drains over runs, each within 1,000 KV operations', async () => {
  const products = Array.from({ length: 250 }, (_, i) => shopifyProduct(i + 1, { updatedAt: '2026-11-01T00:00:00Z' }));
  const apis = createMockApis({ products });
  const { kv, TETHER_SYNC, invocation, used } = kvNamespace();
  await createApp(baseConfig, env, {
    store: kvStore(TETHER_SYNC),
    fetch: apis.fetch,
    sleep: instantSleep,
  }).sync.importAll();
  kv.set('tether-sync:reconcile:since', JSON.stringify('2026-01-01T00:00:00Z'));
  // Ten failed webhooks each for 300 products deleted in Shopify since.
  for (let id = 1001; id <= 1300; id++) {
    for (let webhook = 0; webhook < 10; webhook++) {
      kv.set(
        `${INBOX}${String(id)}:${crypto.randomUUID()}`,
        JSON.stringify({ id: String(id), attempts: 1, error: '503' }),
      );
    }
  }
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const queued = () => [...kv.keys()].filter((key) => key.startsWith(INBOX)).length;
  const retries = () => asList(parseJson(kv.get('tether-sync:reconcile:retry') ?? '[]'), 'the retry list').length;
  const bound = maxReconcileKvOperations(normalizeConfig(baseConfig).reconcile, 45, 'webflow');
  /** @type {number[]} */
  const operations = [];
  for (let run = 0; run < 60 && (queued() || retries()); run++) {
    invocation();
    await worker.scheduled({}, { ...env, TETHER_SYNC }, { waitUntil() {} });
    operations.push(used());
  }
  assert.equal(queued(), 0, `inbox left after ${String(operations.length)} runs`);
  assert.equal(retries(), 0);
  const most = Math.max(...operations);
  assert.ok(most <= bound, `KV operations per run: ${operations.join(', ')}`);
});

test('a default Worker reconcile run uses at most 533 KV operations with Webflow, 573 deploy-only', () => {
  // 18 for the cursor, position, retry list, index, token, deploy hook and webhooks; 201 for a page of 100 inbox keys;
  // a state read for each of the 200 products; and 3 for each of the 38 products the 45 subrequests can take further.
  // Deploy-only, each of the 20 changes writes twice more without a request.
  const settings = normalizeConfig(baseConfig).reconcile;
  assert.equal(maxReconcileKvOperations(settings, 45, 'webflow'), 533);
  assert.equal(maxReconcileKvOperations(settings, 45, 'deploy-only'), 573);
});

const DEPLOY_HOOK = 'https://api.pages.test/deploy_hooks/abc';

/**
 * Runs one deploy-only cron reconcile (a deploy hook, no Webflow) over `count` products none of which the sync has
 * written yet, each a change.
 *
 * @param {NonNullable<import('../src/mapping.ts').RawConfig['reconcile']>} reconcile
 * @param {number} count
 * @returns {Promise<{ used: number, synced: number }>} The run's KV operations, and the products it stored.
 */
async function deployOnlyRun(reconcile, count) {
  const products = Array.from({ length: count }, (_, i) =>
    shopifyProduct(i + 1, { updatedAt: '2026-11-01T00:00:00Z' }),
  );
  const apis = createMockApis({ products });
  /** @type {typeof globalThis.fetch} */
  const fetchWithHook = async (url, init) => (urlOf(url) === DEPLOY_HOOK ? new Response('{}') : apis.fetch(url, init));
  const { kv, TETHER_SYNC, invocation, used } = kvNamespace();
  kv.set('tether-sync:reconcile:since', JSON.stringify('2026-01-01T00:00:00Z'));
  const worker = createWorker({ ...baseConfig, reconcile }, { fetch: fetchWithHook, sleep: instantSleep });
  const deployOnlyEnv = {
    SHOPIFY_ADMIN_TOKEN: env.SHOPIFY_ADMIN_TOKEN,
    SHOPIFY_WEBHOOK_SECRET: env.SHOPIFY_WEBHOOK_SECRET,
    DEPLOY_HOOK_URL: DEPLOY_HOOK,
    TETHER_SYNC,
  };
  invocation();
  await worker.scheduled({}, deployOnlyEnv, { waitUntil() {} });
  const synced = [...kv.keys()].filter((key) => key.startsWith('tether-sync:p:')).length;
  return { used: used(), synced };
}

test('a deploy-only reconcile run stays within the KV operations its bound allows, maxChangesPerRun included', async () => {
  const configs = [
    { maxChangesPerRun: 300, maxProductsPerRun: 300, maxPagesPerRun: 40 },
    { maxChangesPerRun: 100, maxProductsPerRun: 300, maxPagesPerRun: 40 },
    { maxChangesPerRun: 250, maxProductsPerRun: 200, maxPagesPerRun: 40 },
    {},
  ];
  for (const reconcile of configs) {
    const { used, synced } = await deployOnlyRun(reconcile, 300);
    const settings = normalizeConfig({ ...baseConfig, reconcile }).reconcile;
    assert.equal(synced, Math.min(settings.maxChangesPerRun, settings.maxProductsPerRun), JSON.stringify(reconcile));
    const bound = maxReconcileKvOperations(settings, 45, 'deploy-only');
    assert.ok(bound >= used, `${JSON.stringify(reconcile)}: bound ${String(bound)}, used ${String(used)}`);
  }
});

test('the setup check warns when a deploy-only reconcile run can pass 1,000 KV operations through its changes', async () => {
  const shopifyEnv = {
    SHOPIFY_DOMAIN: 'shop.myshopify.com',
    SHOPIFY_ADMIN_TOKEN: 'shpat_token',
    DEPLOY_HOOK_URL: DEPLOY_HOOK,
  };
  /** @param {NonNullable<import('../src/mapping.ts').RawConfig['reconcile']>} reconcile */
  const check = (reconcile) => runCheck({ ...baseConfig, reconcile }, shopifyEnv, { deep: false, worker: true });
  const usual = await check({});
  assert.ok(!usual.steps.some((step) => step.title === 'Reconcile budget'));
  const busy = checkStep(
    await check({ maxChangesPerRun: 400, maxProductsPerRun: 400, maxPagesPerRun: 40 }),
    'Reconcile budget',
  );
  assert.equal(busy.level, 'warn');
  assert.match(busy.message, /up to 1533 KV operations, more than the 1000/);
  assert.match(busy.fix ?? '', /reconcile\.maxChangesPerRun/);
});

test('an item index listed over several runs is finished however short match.indexTtlMinutes is', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)], items: handMadeItems(1200) });
  const { kv, TETHER_SYNC } = kvNamespace();
  kv.set('tether-sync:reconcile:since', JSON.stringify('2026-01-01T00:00:00Z'));
  // An index is stale the moment it is listed.
  const config = { ...baseConfig, match: { indexTtlMinutes: 0 } };
  const worker = createWorker(config, { fetch: apis.fetch, sleep: instantSleep });
  const wenv = { ...env, TETHER_SYNC, MAX_SUBREQUESTS: '15' };
  let runs = 0;
  while (runs < 5 && !(await worker.scheduled({}, wenv, { waitUntil() {} })).complete) runs++;
  assert.ok(runs > 0 && runs < 5, `complete after ${String(runs + 1)} runs`);
  assert.equal(apis.wf.items.size, 1201, 'the product got its item');
});
