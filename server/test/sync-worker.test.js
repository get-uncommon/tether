// The sync's webhook route and the Worker around it: signed webhooks, concurrent invocations, the cron and its caches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, memoryStore, signShopify, handleShopifyWebhook, createWorker } from '../src/index.ts';
import {
  createMockApis,
  shopifyProduct,
  baseConfig,
  env,
  instantSleep,
  fieldOf,
  jsonOf,
  parseJson,
  stringAt,
  kvList,
} from './mocks.js';
import { setup } from './sync-fixtures.js';

/**
 * @param {string} topic
 * @param {unknown} payload
 * @param {{ secret?: string, shop?: string | null }} [options]
 */
async function webhook(topic, payload, { secret = 'whsec', shop = 'shop.myshopify.com' } = {}) {
  const body = JSON.stringify(payload);
  /** @type {Record<string, string>} */
  const headers = { 'x-shopify-topic': topic, 'x-shopify-hmac-sha256': await signShopify(body, secret) };
  if (shop) headers['x-shopify-shop-domain'] = shop;
  return new Request('https://sync.test/webhooks/shopify', { method: 'POST', body, headers });
}

/** @param {Awaited<ReturnType<typeof handleShopifyWebhook>>} handled */
function acceptedTask(handled) {
  assert.ok(handled.task, 'the webhook was accepted');
  return handled.task;
}

test('webhook: verifies HMAC and shop, syncs update, archives on delete', async () => {
  const { app, wf, shop } = setup({ products: [shopifyProduct(1)] });
  const opts = { sync: app.sync, secrets: app.webhookSecrets, shopDomain: 'shop.myshopify.com', sleep: instantSleep };

  let handled = await handleShopifyWebhook(await webhook('products/update', { id: 1 }, { secret: 'wrong' }), opts);
  assert.equal(handled.response.status, 401);
  handled = await handleShopifyWebhook(
    await webhook('products/update', { id: 1 }, { shop: 'evil.myshopify.com' }),
    opts,
  );
  assert.equal(handled.response.status, 403);
  handled = await handleShopifyWebhook(await webhook('products/update', { id: 1 }, { shop: null }), opts);
  assert.equal(handled.response.status, 403, 'a signed webhook without a shop header is not accepted');
  handled = await handleShopifyWebhook(await webhook('orders/create', { id: 1 }), opts);
  assert.equal(handled.response.status, 200);
  assert.equal(handled.task, undefined);

  handled = await handleShopifyWebhook(
    await webhook('products/update', { id: 1, admin_graphql_api_id: 'gid://shopify/Product/1' }),
    opts,
  );
  assert.equal(handled.response.status, 200);
  assert.equal((await acceptedTask(handled)).action, 'created');

  // create arrives right after update for a new product: no duplicate item
  handled = await handleShopifyWebhook(
    await webhook('products/create', { id: 1, admin_graphql_api_id: 'gid://shopify/Product/1' }),
    opts,
  );
  assert.equal((await acceptedTask(handled)).action, 'unchanged');
  assert.equal(wf.items.size, 1);

  shop.products.delete('gid://shopify/Product/1');
  handled = await handleShopifyWebhook(await webhook('products/delete', { id: 1 }), opts);
  assert.equal((await acceptedTask(handled)).action, 'archived');
});

test('webhook: an unsigned topic header cannot delete a live product (Shopify is asked)', async () => {
  const { app, wf } = setup({ products: [shopifyProduct(1)] });
  const opts = { sync: app.sync, secrets: app.webhookSecrets, shopDomain: 'shop.myshopify.com', sleep: instantSleep };
  let handled = await handleShopifyWebhook(
    await webhook('products/update', { id: 1, admin_graphql_api_id: 'gid://shopify/Product/1' }),
    opts,
  );
  assert.equal((await acceptedTask(handled)).action, 'created');
  // The same signed body, replayed with the topic header changed to products/delete.
  handled = await handleShopifyWebhook(
    await webhook('products/delete', { id: 1, admin_graphql_api_id: 'gid://shopify/Product/1' }),
    opts,
  );
  assert.equal(handled.response.status, 200);
  assert.notEqual((await acceptedTask(handled)).action, 'archived');
  const [item] = [...wf.items.values()];
  assert.ok(item && !item.isArchived, 'the live item stays');
});

test('concurrent create + update webhooks for a new product make one item', async () => {
  const { app, wf } = setup({ products: [shopifyProduct(9)] });
  const opts = {
    sync: app.sync,
    secrets: app.webhookSecrets,
    shopDomain: 'shop.myshopify.com',
    sleep: instantSleep,
    createDelayMs: 0,
  };
  const [created, updated] = await Promise.all([
    handleShopifyWebhook(await webhook('products/create', { id: 9 }), opts),
    handleShopifyWebhook(await webhook('products/update', { id: 9 }), opts),
  ]);
  await Promise.all([created.task, updated.task]);
  assert.equal(wf.items.size, 1);
});

/** @returns {import('../src/env.ts').KvBinding & { readonly writes: number }} */
function kv() {
  /** @type {Map<string, string>} */
  const entries = new Map();
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    async get(key, type) {
      const value = entries.get(key);
      if (value == null) return null;
      return type === 'json' ? parseJson(value) : value;
    },
    async put(key, value) {
      writes++;
      entries.set(key, value);
    },
    async delete(key) {
      entries.delete(key);
    },
    list: kvList(() => entries.keys()),
  };
}

test('worker: webhook route with waitUntil, cron reconcile writes KV only on change', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const TETHER_SYNC = kv();
  const wenv = { ...env, TETHER_SYNC, SYNC_SECRET: 's3cret-s3cret-s3cret-s3cret' };
  /** @type {Promise<unknown>[]} */
  const pending = [];
  const ctx = { waitUntil: (/** @type {Promise<unknown>} */ promise) => pending.push(promise) };

  const health = await worker.fetch(new Request('https://sync.test/health'), wenv, ctx);
  const { VERSION } = await import('../src/version.ts');
  const version = stringAt(
    parseJson(await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8')),
    'version',
  );
  assert.equal(VERSION, version, 'src/version.ts matches package.json');
  assert.deepEqual(await health.json(), { ok: true }, 'the version is not shown to strangers');
  const publicCheck = await jsonOf(await worker.fetch(new Request('https://sync.test/check'), wenv, ctx));
  assert.equal(fieldOf(publicCheck, 'version'), undefined);
  const auth = { authorization: `Bearer ${wenv.SYNC_SECRET}` };
  const fullCheck = await jsonOf(
    await worker.fetch(new Request('https://sync.test/check', { headers: auth }), wenv, ctx),
  );
  assert.equal(fieldOf(fullCheck, 'version'), version, 'the version needs the bearer secret');

  const res = await worker.fetch(await webhook('products/update', { id: 1 }), wenv, ctx);
  assert.equal(res.status, 200);
  await Promise.all(pending);
  assert.equal(apis.wf.items.size, 1);

  await TETHER_SYNC.put('tether-sync:reconcile:since', JSON.stringify('2026-01-01T00:00:00Z'));
  const afterWebhook = await worker.scheduled({ cron: '*/10 * * * *' }, wenv, ctx);
  assert.equal(afterWebhook.changes, 0, 'already synced by the webhook');
  const writes = TETHER_SYNC.writes;
  const quiet = await worker.scheduled({}, wenv, ctx);
  assert.equal(quiet.changes, 0);
  assert.equal(TETHER_SYNC.writes, writes, 'quiet runs write nothing to KV');

  const denied = await worker.fetch(new Request('https://sync.test/reconcile', { method: 'POST' }), wenv, ctx);
  assert.equal(denied.status, 401);
  const ok = await worker.fetch(
    new Request('https://sync.test/reconcile', {
      method: 'POST',
      headers: { authorization: 'Bearer s3cret-s3cret-s3cret-s3cret' },
    }),
    wenv,
    ctx,
  );
  assert.equal(ok.status, 200);
});

test('a failed publish is not committed, so the next run publishes again', async () => {
  const { sync, wf, flags } = setup({ products: [shopifyProduct(1)] });
  flags.failPublish = true;
  await assert.rejects(sync.importAll());
  assert.equal(wf.items.size, 1);
  assert.equal(wf.live.size, 0);
  flags.failPublish = false;
  const result = await sync.importAll();
  assert.equal(result.stats.updated, 1, 'not "unchanged": it was never live');
  assert.equal(wf.items.size, 1, 'found the created item, no duplicate');
  assert.equal(wf.live.size, 1);
});

test('concurrent create + update webhooks in two Worker invocations: one item (unique slug)', async () => {
  const apis = createMockApis({ products: [shopifyProduct(5)] });
  /** @type {Map<string, string>} */
  const entries = new Map();
  /** @type {import('../src/env.ts').KvBinding} */
  const TETHER_SYNC = {
    async get(key, type) {
      const value = entries.get(key);
      if (value == null) return null;
      return type === 'json' ? parseJson(value) : value;
    },
    async put(key, value) {
      entries.set(key, value);
    },
    async delete(key) {
      entries.delete(key);
    },
    list: kvList(() => entries.keys()),
  };
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  /** @type {Promise<unknown>[]} */
  const tasks = [];
  const ctx = { waitUntil: (/** @type {Promise<unknown>} */ promise) => tasks.push(promise) };
  /** @param {string} topic */
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
  const fresh = createApp(baseConfig, env, { store: memoryStore(), fetch: apis.fetch, sleep: instantSleep });
  const stale = createApp(baseConfig, env, { store: storeB, fetch: apis.fetch, sleep: instantSleep });
  assert.equal((await fresh.sync.syncById(5)).action, 'created');
  assert.equal((await stale.sync.syncById(5)).action, 'updated');
  assert.equal(apis.wf.items.size, 1);
});

test('caches: the Shopify token and the item index are reused across invocations', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1), shopifyProduct(2)] });
  const store = memoryStore();
  const clientCredentials = { WEBFLOW_TOKEN: 'wf', SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 'sec' };
  const run = () =>
    createApp(baseConfig, clientCredentials, { store, fetch: apis.fetch, sleep: instantSleep }).sync.syncById(1);
  await run();
  await store.delete('p:1'); // force a lookup on the next run
  await run();
  assert.equal(apis.calls.filter((call) => call.path === '/admin/oauth/access_token').length, 1);
  assert.equal(
    apis.calls.filter((call) => call.method === 'GET' && call.path.includes('/items?')).length,
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
  const writesBefore = webflowWrites().length;
  assert.equal((await sync.importAll({ prune: true })).pruned.length, 0);
  assert.equal(webflowWrites().length, writesBefore);
});
