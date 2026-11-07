// The retry list over hours of cron runs: an outage of Webflow loses no queued update or deletion, and a product that
// can't sync is given up on after a day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, createWorker, kvStore } from '../src/index.ts';
import {
  createMockApis,
  shopifyProduct,
  baseConfig,
  env,
  instantSleep,
  asList,
  parseJson,
  stringAt,
  kvList,
  urlOf,
  deliverWebhook,
} from './mocks.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const CRON_INTERVAL_MS = 10 * MINUTE_MS;
const RETRY_KEY = 'tether-sync:reconcile:retry';
const INBOX = 'tether-sync:reconcile:retry:';

/** A KV namespace over a map of the JSON texts it holds, counting the writes of the retry list. */
function kvNamespace() {
  /** @type {Map<string, string>} */
  const kv = new Map();
  let retryListWrites = 0;
  /** @type {import('../src/env.ts').KvBinding} */
  const TETHER_SYNC = {
    async get(key, type) {
      const value = kv.get(key);
      if (value == null) return null;
      return type === 'json' ? parseJson(value) : value;
    },
    async put(key, value) {
      if (key === RETRY_KEY) retryListWrites++;
      kv.set(key, value);
    },
    async delete(key) {
      kv.delete(key);
    },
    list: kvList(() => kv.keys()),
  };
  return { kv, TETHER_SYNC, retryListWrites: () => retryListWrites };
}

/** @param {Map<string, string>} kv */
const retryList = (kv) => asList(parseJson(kv.get(RETRY_KEY) ?? '[]'), 'the retry list');

test('a two-hour Webflow outage loses no queued update or deletion: each reaches Webflow once it is back', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-10T00:00:00Z') });
  const apis = createMockApis({ products: [1, 2, 3, 4].map((number) => shopifyProduct(number)) });
  let outage = false;
  /** @type {typeof globalThis.fetch} */
  const fetchDuringOutage = async (url, init) =>
    outage && new URL(urlOf(url)).host === 'api.webflow.com'
      ? Response.json({ message: 'Service Unavailable' }, { status: 503 })
      : apis.fetch(url, init);
  const { kv, TETHER_SYNC } = kvNamespace();
  const store = kvStore(TETHER_SYNC);
  await createApp(baseConfig, env, { store, fetch: apis.fetch, sleep: instantSleep }).sync.importAll();
  kv.set('tether-sync:reconcile:since', JSON.stringify('2026-11-05T00:00:00Z'));
  const worker = createWorker(baseConfig, { fetch: fetchDuringOutage, sleep: instantSleep });
  const wenv = { ...env, TETHER_SYNC };
  /** @param {number} number */
  const itemOf = (number) => [...apis.wf.items.values()].find((item) => item.fieldData['slug'] === `product-${number}`);
  const edited = '2026-11-09T23:00:00Z';
  // Product 4 has failed to update for 23 hours when its deletion fails too.
  await store.put('reconcile:retry', [
    { id: '4', attempts: 20, error: 'Webflow 400', failingSince: Date.now() - 23 * HOUR_MS, retryAt: Date.now() },
  ]);

  outage = true;
  apis.shop.products.set(shopifyProduct(1).id, shopifyProduct(1, { title: 'Edited 1', updatedAt: edited }));
  await deliverWebhook(worker, wenv, 'products/update', 1);
  apis.shop.products.delete(shopifyProduct(2).id);
  await deliverWebhook(worker, wenv, 'products/delete', 2);
  // Only the reconcile's window finds product 3's edit.
  apis.shop.products.set(shopifyProduct(3).id, shopifyProduct(3, { title: 'Edited 3', updatedAt: edited }));
  apis.shop.products.delete(shopifyProduct(4).id);
  await deliverWebhook(worker, wenv, 'products/delete', 4);
  assert.equal([...kv.keys()].filter((key) => key.startsWith(INBOX)).length, 3, 'the webhooks queued their failures');

  t.mock.method(console, 'error', () => {});
  for (let elapsed = 0; elapsed < 2 * HOUR_MS; elapsed += CRON_INTERVAL_MS) {
    await worker.scheduled({}, wenv, { waitUntil() {} });
    t.mock.timers.tick(CRON_INTERVAL_MS);
  }
  assert.deepEqual(
    retryList(kv)
      .map((entry) => stringAt(entry, 'id'))
      .sort(),
    ['1', '2', '3', '4'],
    'every failure is still listed when the outage ends',
  );

  outage = false;
  for (let elapsed = 0; elapsed < 2 * HOUR_MS; elapsed += CRON_INTERVAL_MS) {
    await worker.scheduled({}, wenv, { waitUntil() {} });
    t.mock.timers.tick(CRON_INTERVAL_MS);
  }
  assert.equal(itemOf(1)?.fieldData['name'], 'Edited 1');
  assert.equal(itemOf(2)?.isArchived, true, 'the deletion its webhook failed on');
  assert.equal(itemOf(3)?.fieldData['name'], 'Edited 3');
  assert.equal(itemOf(4)?.isArchived, true, 'the deletion queued while an update was failing');
  assert.deepEqual(retryList(kv), []);
  assert.deepEqual(
    [...kv.keys()].filter((key) => key.startsWith(INBOX)),
    [],
  );
});

test('a product that keeps failing is retried less often, and given up on with a log after a day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-10T00:00:00Z') });
  // Product 2's later update moves the cursor past the window's overlap with product 1's.
  const products = [shopifyProduct(1, { handle: 'bad' }), shopifyProduct(2, { updatedAt: '2026-11-01T01:00:00Z' })];
  const apis = createMockApis({ products, failCreateFor: 'bad' });
  const { kv, TETHER_SYNC, retryListWrites } = kvNamespace();
  kv.set('tether-sync:reconcile:since', JSON.stringify('2026-11-01T00:00:00Z'));
  /** @type {string[]} */
  const errors = [];
  const log = { info() {}, warn() {}, error: (/** @type {unknown[]} */ ...parts) => errors.push(parts.join(' ')) };
  /** A cron run of the Worker, ten minutes before the next. */
  const cronRun = async () => {
    const store = kvStore(TETHER_SYNC);
    await createApp(baseConfig, env, { store, fetch: apis.fetch, sleep: instantSleep, log }).sync.reconcile();
    t.mock.timers.tick(CRON_INTERVAL_MS);
  };
  const givingUp = () => errors.filter((line) => line.startsWith('giving up on product 1 after a day of failures'));
  const creates = () =>
    apis.calls.filter(
      (call) => call.method === 'POST' && call.path.endsWith('/items') && JSON.stringify(call.body).includes('"bad"'),
    ).length;

  let elapsed = 0;
  for (; elapsed < 23 * HOUR_MS; elapsed += CRON_INTERVAL_MS) {
    await cronRun();
  }
  assert.equal(retryList(kv).length, 1, 'still retried after 23 hours');
  assert.equal(givingUp().length, 0);
  assert.ok(creates() < 30, `${String(creates())} attempts in 23 hours, not one per run`);
  assert.ok(retryListWrites() < 30, `${String(retryListWrites())} writes of the retry list in 23 hours`);

  for (; elapsed < 26 * HOUR_MS; elapsed += CRON_INTERVAL_MS) await cronRun();
  assert.deepEqual(retryList(kv), [], 'given up on');
  assert.equal(givingUp().length, 1);
  const attempts = creates();
  for (let run = 0; run < 6; run++) await cronRun();
  assert.equal(creates(), attempts, 'no attempt after giving up');
});
