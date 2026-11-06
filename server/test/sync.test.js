import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createApp,
  memoryStore,
  signShopify,
  verifyShopifyHmac,
  handleShopifyWebhook,
  createThrottle,
  normalizeConfig,
  mapProduct,
  checkMapping,
  normalizeProduct,
  toSlug,
  createWorker,
} from '../src/index.ts';
import { createMockApis, shopifyProduct, baseConfig, env, instantSleep } from './mocks.js';

const setup = (opts = {}, config = baseConfig) => {
  const apis = createMockApis(opts);
  const store = opts.store || memoryStore();
  const app = createApp(config, env, { store, fetch: apis.fetch, sleep: instantSleep });
  return { ...apis, store, app, sync: app.sync };
};

// ---- pieces -----------------------------------------------------------------

test('HMAC: valid signature passes, tampered body or wrong secret fails', async () => {
  const body = '{"id":1}';
  const sig = await signShopify(body, 'secret');
  assert.equal(await verifyShopifyHmac(body, sig, 'secret'), true);
  assert.equal(await verifyShopifyHmac('{"id":2}', sig, 'secret'), false);
  assert.equal(await verifyShopifyHmac(body, sig, 'other'), false);
  assert.equal(await verifyShopifyHmac(body, null, 'secret'), false);
  // Same as node:crypto (and Shopify's own examples)
  assert.equal(await signShopify('hello', 'key'), createHmac('sha256', 'key').update('hello').digest('base64'));
});

test('mapping: sources, metafields, slug, owned fields and config checks', () => {
  const cfg = normalizeConfig(baseConfig);
  assert.deepEqual(cfg.shopify.metafields, ['custom.material']);
  const p = normalizeProduct(shopifyProduct(7), cfg.shopify.metafields);
  assert.equal(p.compareAtPrice, 15);
  const fd = mapProduct(p, cfg);
  assert.deepEqual(fd, {
    name: 'Product 7',
    slug: 'product-7',
    'shopify-id': '7',
    price: 12.5,
    'main-image': { url: 'https://cdn.test/7.jpg', alt: 'alt' },
    description: '<p>Desc</p>',
    material: 'Oak',
  });
  assert.equal(toSlug('Café Crème 250g!'), 'cafe-creme-250g');
  assert.throws(() => normalizeConfig({ webflowOwned: ['slug'] }), /can't be Webflow-owned/);
  assert.throws(() => normalizeConfig({ onDelete: 'nuke' }), /onDelete/);

  const problems = checkMapping(
    normalizeConfig({ ...baseConfig, fields: { ...baseConfig.fields, price: 'title', gone: 'vendor' } }),
    {
      displayName: 'Products',
      fields: [
        { slug: 'name', type: 'PlainText' },
        { slug: 'slug', type: 'PlainText' },
        { slug: 'price', type: 'Number' },
        { slug: 'main-image', type: 'Image' },
        { slug: 'description', type: 'RichText' },
        { slug: 'material', type: 'PlainText' },
        { slug: 'required-thing', type: 'PlainText', isRequired: true },
      ],
    },
  );
  const text = problems.map((p) => p.message).join('\n');
  assert.match(text, /"gone" doesn't exist/);
  assert.match(text, /"price" is a Number field but maps "title"/);
  assert.match(text, /Required Webflow field "required-thing"/);
  assert.match(text, /no "shopify-id" field/);
});

test('throttle spaces requests and pauses after a 429', async () => {
  let t = 0;
  const waits = [];
  const th = createThrottle({
    perMinute: 60,
    now: () => t,
    sleep: async (ms) => {
      waits.push(ms);
      t += ms;
    },
  });
  await th.wait();
  await th.wait();
  await th.wait();
  assert.deepEqual(waits, [1000, 1000]);
  th.pause(5000);
  await th.wait();
  assert.equal(waits.at(-1), 5000);
});

// ---- sync engine ------------------------------------------------------------

test('import creates and publishes every product; running it again writes nothing', async () => {
  const { sync, wf, webflowWrites } = setup({ products: [shopifyProduct(1), shopifyProduct(2), shopifyProduct(3)] });
  const r = await sync.importAll();
  assert.equal(r.products, 3);
  assert.equal(r.stats.created, 3);
  assert.equal(wf.items.size, 3);
  assert.equal(wf.live.size, 3);
  const publishes = webflowWrites().filter((c) => c.path.endsWith('/items/publish'));
  assert.equal(publishes.length, 1, 'published in one batch');

  const before = webflowWrites().length;
  const again = await sync.importAll();
  assert.equal(again.stats.unchanged, 3);
  assert.equal(webflowWrites().length, before, 'idempotent: no extra writes');
});

test('state survives a new process (store), so a fresh run is still idempotent', async () => {
  const store = memoryStore();
  const first = setup({ products: [shopifyProduct(1)], store });
  await first.sync.importAll();
  const second = createApp(baseConfig, env, { store, fetch: first.fetch, sleep: instantSleep });
  const n = first.webflowWrites().length;
  const r = await second.sync.importAll();
  assert.equal(r.stats.unchanged, 1);
  assert.equal(first.webflowWrites().length, n);
});

test('update sends changed fields but never Webflow-owned ones', async () => {
  const { sync, shop, wf, webflowWrites } = setup({ products: [shopifyProduct(1)] });
  await sync.importAll();
  const item = [...wf.items.values()][0];
  item.fieldData.description = '<p>Edited in Webflow</p>';

  shop.products.set(
    'gid://shopify/Product/1',
    shopifyProduct(1, { title: 'Renamed', descriptionHtml: '<p>New</p>', updatedAt: '2026-11-02T00:00:00Z' }),
  );
  const r = await sync.syncById('1');
  assert.equal(r.action, 'updated');
  const patch = webflowWrites().find((c) => c.method === 'PATCH');
  assert.ok(patch);
  assert.equal(patch.body.fieldData.name, 'Renamed');
  assert.ok(!('description' in patch.body.fieldData));
  assert.equal(item.fieldData.description, '<p>Edited in Webflow</p>');
  assert.ok(wf.live.has(item.id));
});

test('matches existing items by shopify-id, adopts hand-made items by slug', async () => {
  const { sync, wf } = setup({
    products: [shopifyProduct(1, { handle: 'new-handle' }), shopifyProduct(2)],
    items: [
      { id: 'old1', fieldData: { name: 'P1', slug: 'old-handle', 'shopify-id': '1' } },
      { id: 'hand2', fieldData: { name: 'Made by hand', slug: 'product-2' } },
    ],
  });
  const r = await sync.importAll();
  assert.equal(r.stats.updated, 2);
  assert.equal(r.stats.created || 0, 0);
  assert.equal(wf.items.get('old1')?.fieldData.slug, 'new-handle', 'handle change follows to the slug');
  assert.equal(wf.items.get('hand2')?.fieldData['shopify-id'], '2');
});

test('draft/archived products are archived and unpublished; reactivation restores them', async () => {
  const { sync, shop, wf } = setup({ products: [shopifyProduct(1), shopifyProduct(2, { status: 'DRAFT' })] });
  const r = await sync.importAll();
  assert.equal(r.stats.created, 1);
  assert.equal(r.stats.skipped, 1, 'no item created for a draft');

  shop.products.set('gid://shopify/Product/1', shopifyProduct(1, { status: 'ARCHIVED' }));
  assert.equal((await sync.syncById('1')).action, 'archived');
  const item = [...wf.items.values()][0];
  assert.equal(item.isArchived, true);
  assert.equal(wf.live.has(item.id), false);

  shop.products.set('gid://shopify/Product/1', shopifyProduct(1));
  assert.equal((await sync.syncById('1')).action, 'updated');
  assert.equal(item.isArchived, false);
  assert.equal(wf.live.has(item.id), true);
});

test('deleted products: archive (default) or delete', async () => {
  const a = setup({ products: [shopifyProduct(1)] });
  await a.sync.importAll();
  assert.equal((await a.sync.removeProduct(1)).action, 'archived');
  const item = [...a.wf.items.values()][0];
  assert.equal(item.isArchived, true);
  assert.equal(a.wf.live.size, 0);
  assert.equal((await a.sync.removeProduct(999)).action, 'skipped');

  const d = setup({ products: [shopifyProduct(1)] }, { ...baseConfig, onDelete: 'delete' });
  await d.sync.importAll();
  assert.equal((await d.sync.removeProduct('gid://shopify/Product/1')).action, 'deleted');
  assert.equal(d.wf.items.size, 0);
});

test('import --prune archives items whose product is gone', async () => {
  const { sync, wf } = setup({
    products: [shopifyProduct(1)],
    items: [{ id: 'orphan', fieldData: { name: 'Gone', slug: 'gone', 'shopify-id': '42' } }],
  });
  const r = await sync.importAll({ prune: true });
  assert.equal(r.pruned.length, 1);
  assert.equal(wf.items.get('orphan')?.isArchived, true);
});

test('an item deleted by hand in Webflow is recreated', async () => {
  const { sync, shop, wf } = setup({ products: [shopifyProduct(1)] });
  await sync.importAll();
  wf.items.clear();
  shop.products.set('gid://shopify/Product/1', shopifyProduct(1, { title: 'Changed' }));
  assert.equal((await sync.syncById(1)).action, 'created');
  assert.equal(wf.items.size, 1);
});

test('dry run writes nothing', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const store = memoryStore();
  const app = createApp(baseConfig, env, { store, fetch: apis.fetch, dryRun: true, sleep: instantSleep });
  const r = await app.sync.importAll();
  assert.equal(r.stats.created, 1);
  assert.equal(apis.webflowWrites().length, 0);
  assert.equal(store.map.size, 0);
});

// ---- reconcile --------------------------------------------------------------

test('reconcile: only products updated since the cursor, budgeted, resumable, idempotent', async () => {
  const products = [1, 2, 3, 4, 5].map((n) => shopifyProduct(n));
  const { sync, store, shop, wf } = setup({ products }, { ...baseConfig, reconcile: { overlapMinutes: 0 } });
  await store.put('reconcile:since', '2026-11-01T00:00:03Z');

  const r1 = await sync.reconcile({ maxChanges: 2 });
  assert.equal(r1.changes, 2);
  assert.equal(r1.complete, false);
  assert.equal(r1.until, '2026-11-01T00:00:04Z');
  assert.equal(wf.items.size, 2, 'products 3 and 4');

  const r2 = await sync.reconcile({ maxChanges: 2 });
  assert.equal(r2.complete, true);
  assert.equal(r2.changes, 1, 'product 5; 4 is re-read but unchanged');
  assert.equal(wf.items.size, 3);

  const r3 = await sync.reconcile();
  assert.equal(r3.changes, 0);
  assert.equal(await store.get('reconcile:since'), '2026-11-01T00:00:05Z');

  shop.products.set(
    'gid://shopify/Product/1',
    shopifyProduct(1, { title: 'Late edit', updatedAt: '2026-11-03T00:00:00Z' }),
  );
  const r4 = await sync.reconcile();
  assert.equal(r4.changes, 1);
  assert.equal(r4.until, '2026-11-03T00:00:00Z');
});

test('reconcile retries failed products on the next run', async () => {
  const { sync, store, shop } = setup({
    products: [shopifyProduct(1, { handle: 'bad' }), shopifyProduct(2)],
    failCreateFor: 'bad',
  });
  await store.put('reconcile:since', '2026-01-01T00:00:00Z');
  const r1 = await sync.reconcile();
  assert.equal(r1.failures.length, 1);
  assert.equal(r1.changes, 1);
  assert.deepEqual(
    (await store.get('reconcile:retry')).map((f) => f.id),
    ['1'],
  );

  shop.products.set('gid://shopify/Product/1', shopifyProduct(1, { handle: 'fixed' }));
  const r2 = await sync.reconcile();
  assert.equal(r2.failures.length, 0);
  assert.deepEqual(await store.get('reconcile:retry'), []);
});

test('Webflow 429 is retried after Retry-After', async () => {
  const { sync, wf, calls } = setup({ products: [shopifyProduct(1)], rateLimitOnce: true });
  await sync.importAll();
  assert.equal(wf.items.size, 1);
  assert.ok(calls.filter((c) => c.host === 'api.webflow.com').length >= 3);
});

test('client credentials grant: token fetched once and sent to the Admin API', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const app = createApp(
    baseConfig,
    { WEBFLOW_TOKEN: 'wf', SHOPIFY_CLIENT_ID: 'cid', SHOPIFY_CLIENT_SECRET: 'csecret' },
    { store: memoryStore(), fetch: apis.fetch, sleep: instantSleep },
  );
  await app.sync.importAll();
  await app.sync.syncById(1);
  const tokenCalls = apis.calls.filter((c) => c.path === '/admin/oauth/access_token');
  assert.equal(tokenCalls.length, 1);
  assert.match(tokenCalls[0].body, /grant_type=client_credentials/);
  const admin = apis.calls.find((c) => c.path.startsWith('/admin/api/2026-07/'));
  assert.ok(admin);
  assert.equal(new Headers(admin.headers).get('X-Shopify-Access-Token'), 'shpat_fresh');
  assert.deepEqual(app.webhookSecrets, ['csecret'], 'app webhooks are signed with the client secret');
});

// ---- webhooks + worker --------------------------------------------------------

/**
 * @param {string} topic
 * @param {unknown} payload
 * @param {{ secret?: string, shop?: string | null }} [options]
 */
async function webhook(topic, payload, { secret = 'whsec', shop = 'shop.myshopify.com' } = {}) {
  const body = JSON.stringify(payload);
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

  let r = await handleShopifyWebhook(await webhook('products/update', { id: 1 }, { secret: 'wrong' }), opts);
  assert.equal(r.response.status, 401);
  r = await handleShopifyWebhook(await webhook('products/update', { id: 1 }, { shop: 'evil.myshopify.com' }), opts);
  assert.equal(r.response.status, 403);
  r = await handleShopifyWebhook(await webhook('products/update', { id: 1 }, { shop: null }), opts);
  assert.equal(r.response.status, 403, 'a signed webhook without a shop header is not accepted');
  r = await handleShopifyWebhook(await webhook('orders/create', { id: 1 }), opts);
  assert.equal(r.response.status, 200);
  assert.equal(r.task, undefined);

  r = await handleShopifyWebhook(
    await webhook('products/update', { id: 1, admin_graphql_api_id: 'gid://shopify/Product/1' }),
    opts,
  );
  assert.equal(r.response.status, 200);
  assert.equal((await acceptedTask(r)).action, 'created');

  // create arrives right after update for a new product: no duplicate item
  r = await handleShopifyWebhook(
    await webhook('products/create', { id: 1, admin_graphql_api_id: 'gid://shopify/Product/1' }),
    opts,
  );
  assert.equal((await acceptedTask(r)).action, 'unchanged');
  assert.equal(wf.items.size, 1);

  shop.products.delete('gid://shopify/Product/1');
  r = await handleShopifyWebhook(await webhook('products/delete', { id: 1 }), opts);
  assert.equal((await acceptedTask(r)).action, 'archived');
});

test('webhook: an unsigned topic header cannot delete a live product (Shopify is asked)', async () => {
  const { app, wf } = setup({ products: [shopifyProduct(1)] });
  const opts = { sync: app.sync, secrets: app.webhookSecrets, shopDomain: 'shop.myshopify.com', sleep: instantSleep };
  let r = await handleShopifyWebhook(
    await webhook('products/update', { id: 1, admin_graphql_api_id: 'gid://shopify/Product/1' }),
    opts,
  );
  assert.equal((await acceptedTask(r)).action, 'created');
  // The same signed body, replayed with the topic header changed to products/delete.
  r = await handleShopifyWebhook(
    await webhook('products/delete', { id: 1, admin_graphql_api_id: 'gid://shopify/Product/1' }),
    opts,
  );
  assert.equal(r.response.status, 200);
  assert.notEqual((await acceptedTask(r)).action, 'archived');
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
  const [a, b] = await Promise.all([
    handleShopifyWebhook(await webhook('products/create', { id: 9 }), opts),
    handleShopifyWebhook(await webhook('products/update', { id: 9 }), opts),
  ]);
  await Promise.all([a.task, b.task]);
  assert.equal(wf.items.size, 1);
});

/** @returns {import('../src/env.ts').KvBinding & { readonly writes: number }} */
function kv() {
  const m = new Map();
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    async get(k, type) {
      const v = m.get(k);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) {
      writes++;
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
  };
}

test('worker: webhook route with waitUntil, cron reconcile writes KV only on change', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const TETHER_SYNC = kv();
  const wenv = { ...env, TETHER_SYNC, SYNC_SECRET: 's3cret-s3cret-s3cret-s3cret' };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };

  const health = await worker.fetch(new Request('https://sync.test/health'), wenv, ctx);
  const { VERSION } = await import('../src/version.ts');
  const pkg = JSON.parse(
    await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(VERSION, pkg.version, 'src/version.ts matches package.json');
  assert.deepEqual(await health.json(), { ok: true }, 'the version is not shown to strangers');
  const publicCheck = await (await worker.fetch(new Request('https://sync.test/check'), wenv, ctx)).json();
  assert.equal(publicCheck.version, undefined);
  const auth = { authorization: `Bearer ${wenv.SYNC_SECRET}` };
  const fullCheck = await (
    await worker.fetch(new Request('https://sync.test/check', { headers: auth }), wenv, ctx)
  ).json();
  assert.equal(fullCheck.version, pkg.version, 'the version needs the bearer secret');

  const res = await worker.fetch(await webhook('products/update', { id: 1 }), wenv, ctx);
  assert.equal(res.status, 200);
  await Promise.all(pending);
  assert.equal(apis.wf.items.size, 1);

  await TETHER_SYNC.put('tether-sync:reconcile:since', JSON.stringify('2026-01-01T00:00:00Z'));
  const r1 = await worker.scheduled({ cron: '*/10 * * * *' }, wenv, ctx);
  assert.equal(r1.changes, 0, 'already synced by the webhook');
  const writes = TETHER_SYNC.writes;
  const r2 = await worker.scheduled({}, wenv, ctx);
  assert.equal(r2.changes, 0);
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
