// The reconcile: its cursor and page position, its budget of products and subrequests, the first import through
// POST /reconcile, and the retry queue it takes over from failed webhooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, memoryStore, createWorker, signShopify } from '../src/index.ts';
import { createMockApis, shopifyProduct, baseConfig, env, instantSleep, noWaitUntil } from './mocks.js';

const setup = (opts = {}, config = baseConfig) => {
  const apis = createMockApis(opts);
  const store = opts.store || memoryStore();
  const app = createApp(config, env, { store, fetch: apis.fetch, sleep: instantSleep });
  return { ...apis, store, app, sync: app.sync };
};

/** A KV namespace over a map of the JSON texts it holds. */
function kvNamespace() {
  const kv = new Map();
  /** @type {import('../src/env.ts').KvBinding} */
  const TETHER_SYNC = {
    async get(k, t) {
      const v = kv.get(k);
      if (v == null) return null;
      return t === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) {
      kv.set(k, v);
    },
    async delete(k) {
      kv.delete(k);
    },
  };
  return { kv, TETHER_SYNC };
}

test('reconcile: many unchanged products never stall the cursor (page position is saved)', async () => {
  // 30 products with the same updatedAt (a bulk edit), budget of 10 products per run.
  const products = Array.from({ length: 30 }, (_, i) => shopifyProduct(i + 1, { updatedAt: '2026-11-01T10:00:00Z' }));
  const { sync, store } = setup({ products });
  await sync.importAll();
  await store.put('reconcile:since', '2026-11-01T09:00:00Z');
  const seen = [];
  for (let run = 0; run < 10; run++) {
    const r = await sync.reconcile({ maxProducts: 10 });
    seen.push(r.complete);
    if (r.complete) break;
    assert.equal(r.stopped, 'products');
  }
  assert.equal(seen.at(-1), true, `finished after ${seen.length} runs`);
  assert.ok(seen.length <= 5);
  assert.equal(await store.get('reconcile:since'), '2026-11-01T10:00:00Z');
  assert.equal(await store.get('reconcile:page'), null);
});

test('reconcile: overlap catches a product indexed late, just before the cursor', async () => {
  const { sync, store, shop, wf } = setup({ products: [shopifyProduct(1)] });
  await store.put('reconcile:since', '2026-11-02T12:00:00Z');
  shop.products.set('gid://shopify/Product/9', shopifyProduct(9, { updatedAt: '2026-11-02T11:58:00Z' }));
  const r = await sync.reconcile();
  assert.equal(r.changes, 1);
  assert.ok([...wf.items.values()].some((it) => it.fieldData.slug === 'product-9'));
});

test('reconcile: a Shopify error saves progress instead of throwing', async () => {
  const { sync, store, app } = setup({ products: [shopifyProduct(1)] });
  await store.put('reconcile:since', '2026-01-01T00:00:00Z');
  app.shopify.listProducts = async () => {
    throw new Error('boom');
  };
  const r = await sync.reconcile();
  assert.equal(r.complete, false);
  assert.equal(r.stopped, 'error');
  assert.equal(await store.get('reconcile:since'), '2026-01-01T00:00:00Z');
});

test('subrequest budget: a Worker reconcile stops before the limit and resumes next run', async () => {
  const products = Array.from({ length: 12 }, (_, i) => shopifyProduct(i + 1));
  const apis = createMockApis({ products });
  const { kv, TETHER_SYNC } = kvNamespace();
  kv.set('tether-sync:reconcile:since', JSON.stringify('2026-01-01T00:00:00Z'));
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const wenv = { ...env, TETHER_SYNC, MAX_SUBREQUESTS: '15' };
  const runs = [];
  for (let i = 0; i < 10; i++) {
    const before = apis.calls.length;
    const r = await worker.scheduled({}, wenv, { waitUntil() {} });
    runs.push({ r, used: apis.calls.length - before });
    if (r.complete) break;
  }
  assert.ok(runs.length > 1, 'needed more than one run');
  assert.ok(
    runs.every(({ used }) => used <= 15),
    `subrequests per run: ${runs.map((x) => x.used)}`,
  );
  assert.equal(runs[runs.length - 1].r.complete, true);
  assert.equal(apis.wf.items.size, 12);
});

test('POST /reconcile?since=all imports everything, and the cron finishes what one run cannot', async () => {
  const products = Array.from({ length: 10 }, (_, i) =>
    shopifyProduct(i + 1, { updatedAt: `2025-0${(i % 9) + 1}-01T00:00:00Z` }),
  );
  const apis = createMockApis({ products });
  const { kv, TETHER_SYNC } = kvNamespace();
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const secret = 'a-long-random-sync-secret-123';
  const wenv = { ...env, TETHER_SYNC, SYNC_SECRET: secret, MAX_SUBREQUESTS: '14' };
  const res = await worker.fetch(
    new Request('https://w.test/reconcile?since=all', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    }),
    wenv,
    noWaitUntil,
  );
  const first = await res.json();
  assert.equal(first.complete, false, 'too much for one run');
  for (let i = 0; i < 10 && !(await worker.scheduled({}, wenv, { waitUntil() {} })).complete; i++);
  assert.equal(apis.wf.items.size, 10, 'cron finished the import');
  assert.equal(JSON.parse(kv.get('tether-sync:reconcile:since')), '2025-09-01T00:00:00Z');
  const bad = await worker.fetch(
    new Request('https://w.test/reconcile?since=yesterday', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    }),
    wenv,
    noWaitUntil,
  );
  assert.equal(bad.status, 400);
});

test('webhook failure is queued for the next reconcile', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1, { handle: 'bad' })], failCreateFor: 'bad' });
  const store = memoryStore();
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  /** @type {import('../src/env.ts').KvBinding} */
  const kv = {
    async get(k) {
      return store.get(k);
    },
    async put(k, v) {
      return store.put(k, JSON.parse(v));
    },
    async delete(k) {
      return store.delete(k);
    },
  };
  const tasks = [];
  const body = JSON.stringify({ id: 1 });
  await worker.fetch(
    new Request('https://w.test/webhooks/shopify', {
      method: 'POST',
      body,
      headers: {
        'x-shopify-topic': 'products/update',
        'x-shopify-hmac-sha256': await signShopify(body, 'whsec'),
        'x-shopify-shop-domain': 'shop.myshopify.com',
      },
    }),
    { ...env, TETHER_SYNC: kv },
    { waitUntil: (p) => tasks.push(p) },
  );
  await Promise.all(tasks);
  assert.deepEqual(
    // The retry queue as the reconcile stores it.
    /** @type {{ id: string }[]} */ (await store.get('tether-sync:reconcile:retry')).map((r) => r.id),
    ['1'],
  );
});
