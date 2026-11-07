// The reconcile: its cursor and page position, its budget of products and subrequests, the first import through
// POST /reconcile, and the retry queue it takes over from failed webhooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, memoryStore, createWorker, signShopify } from '../src/index.ts';
import {
  createMockApis,
  shopifyProduct,
  baseConfig,
  env,
  instantSleep,
  noWaitUntil,
  asList,
  fieldOf,
  jsonOf,
  parseJson,
  stringAt,
  kvList,
} from './mocks.js';

/**
 * @param {Parameters<typeof createMockApis>[0] & { store?: import('../src/store.ts').Store }} [opts]
 * @param {import('../src/mapping.ts').RawConfig} [config]
 */
const setup = (opts = {}, config = baseConfig) => {
  const apis = createMockApis(opts);
  const store = opts.store ?? memoryStore();
  const app = createApp(config, env, { store, fetch: apis.fetch, sleep: instantSleep });
  return { ...apis, store, app, sync: app.sync };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A KV namespace over a map of the JSON texts it holds. */
function kvNamespace() {
  /** @type {Map<string, string>} */
  const kv = new Map();
  /** @type {import('../src/env.ts').KvBinding} */
  const TETHER_SYNC = {
    async get(key, type) {
      const value = kv.get(key);
      if (value == null) return null;
      return type === 'json' ? parseJson(value) : value;
    },
    async put(key, value) {
      kv.set(key, value);
    },
    async delete(key) {
      kv.delete(key);
    },
    list: kvList(() => kv.keys()),
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
    const result = await sync.reconcile({ maxProducts: 10 });
    seen.push(result.complete);
    if (result.complete) break;
    assert.equal(result.stopped, 'products');
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
  const result = await sync.reconcile();
  assert.equal(result.changes, 1);
  assert.ok([...wf.items.values()].some((item) => item.fieldData['slug'] === 'product-9'));
});

test('reconcile: a Shopify error saves progress instead of throwing', async () => {
  const { sync, store, app } = setup({ products: [shopifyProduct(1)] });
  await store.put('reconcile:since', '2026-01-01T00:00:00Z');
  app.shopify.listProductEdges = async () => {
    throw new Error('boom');
  };
  const result = await sync.reconcile();
  assert.equal(result.complete, false);
  assert.equal(result.stopped, 'error');
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
    const result = await worker.scheduled({}, wenv, { waitUntil() {} });
    runs.push({ result, used: apis.calls.length - before });
    if (result.complete) break;
  }
  assert.ok(runs.length > 1, 'needed more than one run');
  assert.ok(
    runs.every(({ used }) => used <= 15),
    `subrequests per run: ${runs.map((run) => run.used).join(', ')}`,
  );
  assert.equal(runs.at(-1)?.result.complete, true);
  assert.equal(apis.wf.items.size, 12);
});

/** @param {number} count Hand-made Webflow items, none of them a product's. */
const handMadeItems = (count) =>
  Array.from({ length: count }, (_, i) => ({ id: `hand${i}`, fieldData: { name: `Hand ${i}`, slug: `hand-${i}` } }));

/**
 * @param {ReturnType<typeof createMockApis>['calls']} calls
 * @returns {number[]} The offsets of the item pages listed.
 */
const listedOffsets = (calls) =>
  calls
    .filter((call) => call.method === 'GET' && call.path.includes('/items?'))
    .map((call) => Number(new URL(call.path, 'https://api.webflow.com').searchParams.get('offset')));

test('subrequest budget: an item index too big for one run is listed over several, each page once', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)], items: handMadeItems(1200) });
  const { kv, TETHER_SYNC } = kvNamespace();
  kv.set('tether-sync:reconcile:since', JSON.stringify('2026-01-01T00:00:00Z'));
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const wenv = { ...env, TETHER_SYNC, MAX_SUBREQUESTS: '15' };
  const used = [];
  let complete = false;
  for (let run = 0; run < 5 && !complete; run++) {
    const before = apis.calls.length;
    complete = (await worker.scheduled({}, wenv, { waitUntil() {} })).complete;
    used.push(apis.calls.length - before);
  }
  assert.ok(complete);
  assert.ok(used.length > 1, 'needed more than one run');
  assert.ok(
    used.every((count) => count <= 15),
    `subrequests per run: ${used.join(', ')}`,
  );
  assert.deepEqual(
    listedOffsets(apis.calls),
    Array.from({ length: 12 }, (_, i) => i * 100),
  );
  assert.equal(apis.wf.items.size, 1201, 'the product got one item');
  assert.equal(kv.get('tether-sync:index:listing'), undefined, 'the finished listing is cleared');
  assert.ok(kv.get('tether-sync:index'));
});

test('a webhook lists at most 15 pages of the item index, and the reconcile finishes the listing and the product', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)], items: handMadeItems(2000) });
  const { kv, TETHER_SYNC } = kvNamespace();
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const wenv = { ...env, TETHER_SYNC, MAX_SUBREQUESTS: '1000' };
  /** @type {Promise<unknown>[]} */
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
    wenv,
    { waitUntil: (/** @type {Promise<unknown>} */ promise) => tasks.push(promise) },
  );
  await Promise.all(tasks);
  assert.equal(listedOffsets(apis.calls).length, 15);
  assert.equal(apis.wf.items.size, 2000, 'nothing written yet');
  assert.ok(
    [...kv.keys()].some((key) => key.startsWith('tether-sync:reconcile:retry:1:')),
    'the product is queued for the reconcile',
  );

  kv.set('tether-sync:reconcile:since', JSON.stringify('2026-12-01T00:00:00Z'));
  const result = await worker.scheduled({}, wenv, { waitUntil() {} });
  assert.equal(result.complete, true);
  assert.deepEqual(
    listedOffsets(apis.calls),
    Array.from({ length: 20 }, (_, i) => i * 100),
  );
  assert.equal(apis.wf.items.size, 2001);
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
  const first = await jsonOf(res);
  assert.equal(fieldOf(first, 'complete'), false, 'too much for one run');
  for (let i = 0; i < 10 && !(await worker.scheduled({}, wenv, { waitUntil() {} })).complete; i++);
  assert.equal(apis.wf.items.size, 10, 'cron finished the import');
  const since = kv.get('tether-sync:reconcile:since');
  assert.ok(since !== undefined);
  assert.equal(JSON.parse(since), '2025-09-01T00:00:00Z');
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

test('webhook failure is queued under its own key, and the next reconcile takes it into the retry list', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1, { handle: 'bad' })], failCreateFor: 'bad' });
  const { kv, TETHER_SYNC } = kvNamespace();
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  /** @type {Promise<unknown>[]} */
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
    { ...env, TETHER_SYNC },
    { waitUntil: (/** @type {Promise<unknown>} */ promise) => tasks.push(promise) },
  );
  await Promise.all(tasks);
  const queued = () => [...kv.keys()].filter((key) => key.startsWith('tether-sync:reconcile:retry:'));
  assert.equal(queued().length, 1);
  assert.match(queued()[0] ?? '', /^tether-sync:reconcile:retry:1:/);

  kv.set('tether-sync:reconcile:since', JSON.stringify('2026-12-01T00:00:00Z'));
  await worker.scheduled({}, { ...env, TETHER_SYNC }, { waitUntil() {} });
  const retry = asList(parseJson(kv.get('tether-sync:reconcile:retry') ?? 'null'), 'the retry list');
  assert.deepEqual(
    retry.map((entry) => [stringAt(entry, 'id'), fieldOf(entry, 'attempts')]),
    [['1', 2]],
    'the reconcile retried it and failed again',
  );
  assert.deepEqual(queued(), [], 'its key is deleted once the list holds it');
});

test('a webhook failure queued while a reconcile runs survives the end of that reconcile', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1), shopifyProduct(2)] });
  const store = memoryStore();
  const reconciling = createApp(baseConfig, env, { store, fetch: apis.fetch, sleep: instantSleep });
  await reconciling.sync.importAll();
  const deletedItem = [...apis.wf.items.values()].find((item) => item.fieldData['slug'] === 'product-2');
  assert.ok(deletedItem);
  // Product 2 is deleted in Shopify, and its products/delete webhook fails in another invocation while a reconcile
  // retries product 1.
  apis.shop.products.delete('gid://shopify/Product/2');
  await store.put('reconcile:retry', [{ id: '1', attempts: 1, error: 'webhook failed' }]);
  const webhookApp = createApp(baseConfig, env, { store, fetch: apis.fetch, sleep: instantSleep });
  let queuedMeanwhile = false;
  /** @type {typeof fetch} */
  const fetchQueueingOnce = async (input, init) => {
    if (!queuedMeanwhile && typeof init?.body === 'string' && init.body.includes('Product/1')) {
      queuedMeanwhile = true;
      await webhookApp.sync.queueRetry('gid://shopify/Product/2', new Error('Webflow 503'));
    }
    return apis.fetch(input, init);
  };
  const app = createApp(baseConfig, env, { store, fetch: fetchQueueingOnce, sleep: instantSleep });
  await app.sync.reconcile();
  assert.ok(queuedMeanwhile, 'the webhook failed during the reconcile');

  await reconciling.sync.reconcile();
  assert.equal(apis.wf.items.get(deletedItem.id)?.isArchived, true, 'the next reconcile archived the deleted product');
});

test('reconcile: a failed publish leaves every product of the run for the next one, retries included', async () => {
  const products = Array.from({ length: 6 }, (_, i) => shopifyProduct(i + 1));
  // Product 7 was updated before the window: only the retry list brings it back.
  const outside = shopifyProduct(7, { updatedAt: '2026-10-01T00:00:00Z' });
  const { sync, store, wf, flags } = setup({ products: [...products, outside], maxFirst: 2 });
  await store.put('reconcile:since', '2026-11-01T00:00:00Z');
  await store.put('reconcile:retry', [{ id: '7', attempts: 1, error: 'webhook failed' }]);
  flags.failPublish = true;
  const failed = await sync.reconcile();
  assert.equal(failed.stopped, 'publish');
  assert.ok(failed.pages >= 3, 'the listing went past the first page');
  assert.equal(wf.live.size, 0);
  const retry = asList(await store.get('reconcile:retry'), 'the retry list');
  assert.deepEqual(retry.map((entry) => stringAt(entry, 'id')).sort(), ['1', '2', '3', '4', '5', '6', '7']);
  assert.ok(
    retry.every((entry) => fieldOf(entry, 'attempts') === 1),
    'a publish call that failed as a whole costs no attempt',
  );
  flags.failPublish = false;
  for (let run = 0; run < 5 && !(await sync.reconcile()).complete; run++);
  assert.equal(wf.live.size, 7, 'every product is live');
  assert.deepEqual(await store.get('reconcile:retry'), []);
});

test('reconcile: a product Webflow refuses to publish is retried, and given up on after a day', async () => {
  const { sync, store, wf, flags } = setup({ products: [shopifyProduct(1), shopifyProduct(2)] });
  await store.put('reconcile:since', '2026-11-01T00:00:00Z');
  flags.refusePublishFor = 'product-2';
  /** @returns {Promise<unknown[]>} The retry list, as [id, attempts]. */
  const retries = async () =>
    asList(await store.get('reconcile:retry'), 'the retry list').map((entry) => [
      stringAt(entry, 'id'),
      fieldOf(entry, 'attempts'),
    ]);
  const result = await sync.reconcile();
  assert.equal(result.stopped, 'publish');
  assert.equal(wf.live.size, 1);
  assert.deepEqual(await retries(), [['2', 1]]);
  await sync.reconcile();
  assert.deepEqual(await retries(), [['2', 2]], 'each refusal costs an attempt');
  const failingSince = Date.now() - DAY_MS;
  await store.put('reconcile:retry', [{ id: '2', attempts: 5, error: 'refused', failingSince, retryAt: 0 }]);
  await store.put('reconcile:since', '2026-11-02T00:00:00Z');
  await sync.reconcile();
  assert.deepEqual(await retries(), [], 'given up on after a day of failures');
});

test('reconcile: a retried product in the window is synced once, and is still given up on', async () => {
  const { sync, store, calls } = setup({ products: [shopifyProduct(1, { handle: 'bad' })], failCreateFor: 'bad' });
  await store.put('reconcile:since', '2026-11-01T00:00:00Z');
  const failingSince = Date.now() - DAY_MS;
  await store.put('reconcile:retry', [{ id: '1', attempts: 4, error: 'webhook failed', failingSince, retryAt: 0 }]);
  const creates = () => calls.filter((call) => call.method === 'POST' && call.path.endsWith('/items')).length;
  await sync.reconcile();
  assert.equal(creates(), 1, 'one create, from the retry');
  assert.deepEqual(await store.get('reconcile:retry'), [], 'given up on after its fifth attempt in a day');
});

test('reconcile: products edited between two runs of a window are neither skipped nor lost', async () => {
  const products = Array.from({ length: 4 }, (_, i) => shopifyProduct(i + 1));
  const { sync, store, shop, wf } = setup({ products, maxFirst: 4 });
  await store.put('reconcile:since', '2026-11-01T00:00:00Z');
  const first = await sync.reconcile({ maxProducts: 2 });
  assert.equal(first.stopped, 'products');
  // The merchant edits product 1, which the first run did: it moves to the end of the listing.
  shop.products.set(
    'gid://shopify/Product/1',
    shopifyProduct(1, { title: 'Edited', updatedAt: '2026-11-01T00:05:00Z' }),
  );
  for (let run = 0; run < 5 && !(await sync.reconcile({ maxProducts: 2 })).complete; run++);
  const slugs = [...wf.items.values()].map((item) => item.fieldData['slug']).sort();
  assert.deepEqual(slugs, ['product-1', 'product-2', 'product-3', 'product-4']);
  assert.ok([...wf.items.values()].some((item) => item.fieldData['name'] === 'Edited'));
  assert.equal(await store.get('reconcile:since'), '2026-11-01T00:05:00Z');
});

test('reconcile: a window position stored with a page offset resumes from that page, without skipping', async () => {
  const products = Array.from({ length: 4 }, (_, i) => shopifyProduct(i + 1));
  const { sync, store, wf } = setup({ products, maxFirst: 4 });
  await store.put('reconcile:since', '2026-11-01T00:00:00Z');
  await store.put('reconcile:page', {
    since: '2026-11-01T00:00:00Z',
    after: null,
    offset: 2,
    newest: '2026-11-01T00:00:02Z',
  });
  const result = await sync.reconcile();
  assert.equal(result.complete, true);
  assert.equal(wf.items.size, 4, 'the products before the offset are synced too');
  assert.equal(await store.get('reconcile:page'), null);
});
