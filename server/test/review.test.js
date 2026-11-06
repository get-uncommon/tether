// The sync under load and failure: query cost, cursor progress, publish commits,
// concurrent creates, subrequest budget, caches, file store, auth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, memoryStore, createWorker, signShopify, createShopify, pageSizeFor } from '../src/index.ts';
import { fileStore } from '../src/node.ts';
import { createMockApis, shopifyProduct, baseConfig, env, instantSleep, noWaitUntil } from './mocks.js';

const setup = (opts = {}, config = baseConfig, extra = {}) => {
  const apis = createMockApis(opts);
  const store = opts.store || memoryStore();
  const app = createApp(config, env, { store, fetch: apis.fetch, sleep: instantSleep, ...extra });
  return { ...apis, store, app, sync: app.sync };
};

test('query cost: pages stay under 1,000 points, and shrink when Shopify still says too much', async () => {
  assert.ok(pageSizeFor() * (6 + 25 + 10) <= 1000);
  const apis = createMockApis({ products: [1, 2, 3, 4, 5, 6].map((n) => shopifyProduct(n)), maxFirst: 4 });
  const shopify = createShopify({
    domain: 'shop.myshopify.com',
    adminToken: 'x',
    fetch: apis.fetch,
    sleep: instantSleep,
  });
  const page = await shopify.listProducts({});
  assert.equal(page.products.length, 4);
  assert.ok(shopify.pageSize <= 4, 'remembers the smaller page size');
});

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

test('a failed publish is not committed, so the next run publishes again', async () => {
  const { sync, wf, flags } = setup({ products: [shopifyProduct(1)] });
  flags.failPublish = true;
  await assert.rejects(sync.importAll());
  assert.equal(wf.items.size, 1);
  assert.equal(wf.live.size, 0);
  flags.failPublish = false;
  const r = await sync.importAll();
  assert.equal(r.stats.updated, 1, 'not "unchanged": it was never live');
  assert.equal(wf.items.size, 1, 'found the created item, no duplicate');
  assert.equal(wf.live.size, 1);
});

test('concurrent create + update webhooks in two Worker invocations: one item (unique slug)', async () => {
  const apis = createMockApis({ products: [shopifyProduct(5)] });
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
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const tasks = [];
  const ctx = { waitUntil: (p) => tasks.push(p) };
  const hook = async (topic) => {
    const body = JSON.stringify({ id: 5 });
    return new Request('https://w.test/webhooks/shopify', {
      method: 'POST',
      body,
      headers: {
        'x-shopify-topic': topic,
        'x-shopify-hmac-sha256': await signShopify(body, 'whsec'),
        'x-shopify-shop-domain': 'shop.myshopify.com',
      },
    });
  };
  // separate invocations = separate sync instances
  await Promise.all([
    worker.fetch(await hook('products/update'), { ...env, TETHER_SYNC }, ctx),
    worker.fetch(await hook('products/update'), { ...env, TETHER_SYNC }, ctx),
  ]);
  await Promise.all(tasks);
  assert.equal(apis.wf.items.size, 1);
});

test('slug conflict with a stale index: refreshes, finds the item by shopify-id, updates it', async () => {
  const apis = createMockApis({ products: [shopifyProduct(5)] });
  const storeB = memoryStore();
  await storeB.put('index', { at: new Date().toISOString(), byId: {}, bySlug: {} }); // fresh but stale cache
  const a = createApp(baseConfig, env, { store: memoryStore(), fetch: apis.fetch, sleep: instantSleep });
  const b = createApp(baseConfig, env, { store: storeB, fetch: apis.fetch, sleep: instantSleep });
  assert.equal((await a.sync.syncById(5)).action, 'created');
  assert.equal((await b.sync.syncById(5)).action, 'updated');
  assert.equal(apis.wf.items.size, 1);
});

test('subrequest budget: a Worker reconcile stops before the limit and resumes next run', async () => {
  const products = Array.from({ length: 12 }, (_, i) => shopifyProduct(i + 1));
  const apis = createMockApis({ products });
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

test('caches: the Shopify token and the item index are reused across invocations', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1), shopifyProduct(2)] });
  const store = memoryStore();
  const cc = { WEBFLOW_TOKEN: 'wf', SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 'sec' };
  const run = () => createApp(baseConfig, cc, { store, fetch: apis.fetch, sleep: instantSleep }).sync.syncById(1);
  await run();
  await store.delete('p:1'); // force a lookup on the next run
  await run();
  assert.equal(apis.calls.filter((c) => c.path === '/admin/oauth/access_token').length, 1);
  assert.equal(
    apis.calls.filter((c) => c.method === 'GET' && c.path.includes('/items?')).length,
    1,
    'collection listed once',
  );
});

test('a draft product whose item was deleted in Webflow is not recreated', async () => {
  const { sync, shop, wf, store } = setup({ products: [shopifyProduct(1)] });
  await sync.importAll();
  wf.items.clear();
  shop.products.set('gid://shopify/Product/1', shopifyProduct(1, { status: 'DRAFT', title: 'x' }));
  assert.equal((await sync.syncById(1)).action, 'skipped');
  assert.equal(wf.items.size, 0);
  assert.equal(await store.get('p:1'), null);
});

test('prune with onDelete "unpublish" does not repeat itself', async () => {
  const { sync, webflowWrites } = setup(
    {
      products: [shopifyProduct(1)],
      items: [{ id: 'orphan', fieldData: { name: 'Gone', slug: 'gone', 'shopify-id': '42' } }],
    },
    { ...baseConfig, onDelete: 'unpublish' },
  );
  assert.equal((await sync.importAll({ prune: true })).pruned.length, 1);
  const n = webflowWrites().length;
  assert.equal((await sync.importAll({ prune: true })).pruned.length, 0);
  assert.equal(webflowWrites().length, n);
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

test('SYNC_SECRET "none" does not open /reconcile; /check without it hides values', async () => {
  const apis = createMockApis();
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const wenv = { ...env, SYNC_SECRET: 'none', SHOPIFY_DOMAIN: 'secret-shop.myshopify.com' };
  const r = await worker.fetch(
    new Request('https://w.test/reconcile', { method: 'POST', headers: { authorization: 'Bearer none' } }),
    wenv,
    noWaitUntil,
  );
  assert.equal(r.status, 401);
  const check = await (await worker.fetch(new Request('https://w.test/check'), wenv, noWaitUntil)).text();
  assert.ok(!check.includes('secret-shop'));
});

test('file store: batched writes, merged with another process, survives a failed write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tether-sync-'));
  const path = join(dir, 'state.json');
  const a = fileStore(path, { delayMs: 10_000 });
  const b = fileStore(path, { delayMs: 10_000 });
  for (let i = 0; i < 100; i++) await a.put(`p:${i}`, { i });
  await b.put('reconcile:since', 'x');
  await b.flush();
  await a.flush();
  const disk = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(Object.keys(disk).length, 101, "both processes' keys are kept");
  assert.deepEqual(await b.get('p:5'), { i: 5 }, "b sees a's writes");

  const bad = fileStore(join(dir, 'missing-dir', 'state.json'), { delayMs: 10_000 });
  await bad.put('k', 1);
  await assert.rejects(bad.flush());
  await assert.rejects(bad.flush(), 'still dirty, retried');
});

test('POST /reconcile?since=all imports everything, and the cron finishes what one run cannot', async () => {
  const products = Array.from({ length: 10 }, (_, i) =>
    shopifyProduct(i + 1, { updatedAt: `2025-0${(i % 9) + 1}-01T00:00:00Z` }),
  );
  const apis = createMockApis({ products });
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
