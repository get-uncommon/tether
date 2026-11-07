import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createApp,
  memoryStore,
  kvStore,
  signShopify,
  verifyShopifyHmac,
  createThrottle,
  normalizeConfig,
  mapProduct,
  checkMapping,
  normalizeProduct,
  toSlug,
} from '../src/index.ts';
import {
  createMockApis,
  shopifyProduct,
  baseConfig,
  env,
  instantSleep,
  recordAt,
  asString,
  asList,
  fieldOf,
} from './mocks.js';
import { setup } from './sync-fixtures.js';

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
  const product = normalizeProduct(shopifyProduct(7), cfg.shopify.metafields);
  assert.equal(product.compareAtPrice, 15);
  const fieldData = mapProduct(product, cfg);
  assert.deepEqual(fieldData, {
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
  const text = problems.map((problem) => problem.message).join('\n');
  assert.match(text, /"gone" doesn't exist/);
  assert.match(text, /"price" is a Number field but maps "title"/);
  assert.match(text, /Required Webflow field "required-thing"/);
  assert.match(text, /no "shopify-id" field/);
});

test('throttle spaces requests and pauses after a 429', async () => {
  let clock = 0;
  /** @type {number[]} */
  const waits = [];
  const throttle = createThrottle({
    perMinute: 60,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  await throttle.wait();
  await throttle.wait();
  await throttle.wait();
  assert.deepEqual(waits, [1000, 1000]);
  throttle.pause(5000);
  await throttle.wait();
  assert.equal(waits.at(-1), 5000);
});

// ---- sync engine ------------------------------------------------------------

test('import creates and publishes every product; running it again writes nothing', async () => {
  const { sync, wf, webflowWrites } = setup({ products: [shopifyProduct(1), shopifyProduct(2), shopifyProduct(3)] });
  const result = await sync.importAll();
  assert.equal(result.products, 3);
  assert.equal(result.stats.created, 3);
  assert.equal(wf.items.size, 3);
  assert.equal(wf.live.size, 3);
  const publishes = webflowWrites().filter((call) => call.path.endsWith('/items/publish'));
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
  const writesBefore = first.webflowWrites().length;
  const result = await second.sync.importAll();
  assert.equal(result.stats.unchanged, 1);
  assert.equal(first.webflowWrites().length, writesBefore);
});

test('update sends changed fields but never Webflow-owned ones', async () => {
  const { sync, shop, wf, webflowWrites } = setup({ products: [shopifyProduct(1)] });
  await sync.importAll();
  const [item] = [...wf.items.values()];
  assert.ok(item);
  item.fieldData['description'] = '<p>Edited in Webflow</p>';

  shop.products.set(
    'gid://shopify/Product/1',
    shopifyProduct(1, { title: 'Renamed', descriptionHtml: '<p>New</p>', updatedAt: '2026-11-02T00:00:00Z' }),
  );
  const result = await sync.syncById('1');
  assert.equal(result.action, 'updated');
  const patch = webflowWrites().find((call) => call.method === 'PATCH');
  assert.ok(patch);
  const fieldData = recordAt(patch.body, 'fieldData');
  assert.equal(fieldData['name'], 'Renamed');
  assert.ok(!('description' in fieldData));
  assert.equal(item.fieldData['description'], '<p>Edited in Webflow</p>');
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
  const result = await sync.importAll();
  assert.equal(result.stats.updated, 2);
  assert.equal(result.stats.created || 0, 0);
  assert.equal(wf.items.get('old1')?.fieldData['slug'], 'new-handle', 'handle change follows to the slug');
  assert.equal(wf.items.get('hand2')?.fieldData['shopify-id'], '2');
});

test('draft/archived products are archived and unpublished; reactivation restores them', async () => {
  const { sync, shop, wf } = setup({ products: [shopifyProduct(1), shopifyProduct(2, { status: 'DRAFT' })] });
  const result = await sync.importAll();
  assert.equal(result.stats.created, 1);
  assert.equal(result.stats.skipped, 1, 'no item created for a draft');

  shop.products.set('gid://shopify/Product/1', shopifyProduct(1, { status: 'ARCHIVED' }));
  assert.equal((await sync.syncById('1')).action, 'archived');
  const [item] = [...wf.items.values()];
  assert.ok(item);
  assert.equal(item.isArchived, true);
  assert.equal(wf.live.has(item.id), false);

  shop.products.set('gid://shopify/Product/1', shopifyProduct(1));
  assert.equal((await sync.syncById('1')).action, 'updated');
  assert.equal(item.isArchived, false);
  assert.equal(wf.live.has(item.id), true);
});

test('deleted products: archive (default) or delete', async () => {
  const archiving = setup({ products: [shopifyProduct(1)] });
  await archiving.sync.importAll();
  assert.equal((await archiving.sync.removeProduct(1)).action, 'archived');
  const [item] = [...archiving.wf.items.values()];
  assert.ok(item);
  assert.equal(item.isArchived, true);
  assert.equal(archiving.wf.live.size, 0);
  assert.equal((await archiving.sync.removeProduct(999)).action, 'skipped');

  const deleting = setup({ products: [shopifyProduct(1)] }, { ...baseConfig, onDelete: 'delete' });
  await deleting.sync.importAll();
  assert.equal((await deleting.sync.removeProduct('gid://shopify/Product/1')).action, 'deleted');
  assert.equal(deleting.wf.items.size, 0);
});

test('import --prune archives items whose product is gone', async () => {
  const { sync, wf } = setup({
    products: [shopifyProduct(1)],
    items: [{ id: 'orphan', fieldData: { name: 'Gone', slug: 'gone', 'shopify-id': '42' } }],
  });
  const result = await sync.importAll({ prune: true });
  assert.equal(result.pruned.length, 1);
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
  const result = await app.sync.importAll();
  assert.equal(result.stats.created, 1);
  assert.equal(apis.webflowWrites().length, 0);
  assert.equal(store.map.size, 0);
});

// ---- reconcile --------------------------------------------------------------

test('reconcile: only products updated since the cursor, budgeted, resumable, idempotent', async () => {
  const products = [1, 2, 3, 4, 5].map((number) => shopifyProduct(number));
  const { sync, store, shop, wf } = setup({ products }, { ...baseConfig, reconcile: { overlapMinutes: 0 } });
  await store.put('reconcile:since', '2026-11-01T00:00:03Z');

  const first = await sync.reconcile({ maxChanges: 2 });
  assert.equal(first.changes, 2);
  assert.equal(first.complete, false);
  assert.equal(first.until, '2026-11-01T00:00:04Z');
  assert.equal(wf.items.size, 2, 'products 3 and 4');

  const second = await sync.reconcile({ maxChanges: 2 });
  assert.equal(second.complete, true);
  assert.equal(second.changes, 1, 'product 5; 4 is re-read but unchanged');
  assert.equal(wf.items.size, 3);

  const third = await sync.reconcile();
  assert.equal(third.changes, 0);
  assert.equal(await store.get('reconcile:since'), '2026-11-01T00:00:05Z');

  shop.products.set(
    'gid://shopify/Product/1',
    shopifyProduct(1, { title: 'Late edit', updatedAt: '2026-11-03T00:00:00Z' }),
  );
  const afterEdit = await sync.reconcile();
  assert.equal(afterEdit.changes, 1);
  assert.equal(afterEdit.until, '2026-11-03T00:00:00Z');
});

test('reconcile retries failed products on the next run', async () => {
  const { sync, store, shop } = setup({
    products: [shopifyProduct(1, { handle: 'bad' }), shopifyProduct(2)],
    failCreateFor: 'bad',
  });
  await store.put('reconcile:since', '2026-01-01T00:00:00Z');
  const first = await sync.reconcile();
  assert.equal(first.failures.length, 1);
  assert.equal(first.changes, 1);
  const retry = asList(await store.get('reconcile:retry'), 'reconcile:retry');
  assert.deepEqual(
    retry.map((entry) => fieldOf(entry, 'id')),
    ['1'],
  );

  shop.products.set('gid://shopify/Product/1', shopifyProduct(1, { handle: 'fixed' }));
  const retried = await sync.reconcile();
  assert.equal(retried.failures.length, 0);
  assert.deepEqual(await store.get('reconcile:retry'), []);
});

test('kvStore lists the keys under a prefix across pages, without its own prefix', async () => {
  const names = ['tether-sync:a:1', 'tether-sync:a:2', 'tether-sync:a:3', 'tether-sync:b:1', 'other:a:1'];
  /** @type {(string | undefined)[]} */
  const cursors = [];
  const store = kvStore({
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    async list({ prefix, cursor }) {
      cursors.push(cursor);
      const matching = names.filter((name) => name.startsWith(prefix));
      const start = Number(cursor ?? 0);
      const keys = matching.slice(start, start + 2).map((name) => ({ name }));
      return start + 2 < matching.length
        ? { keys, list_complete: false, cursor: String(start + 2) }
        : { keys, list_complete: true };
    },
  });
  assert.deepEqual(await store.list('a:'), ['a:1', 'a:2', 'a:3']);
  assert.deepEqual(cursors, [undefined, '2']);
});

test('Webflow 429 is retried after Retry-After', async () => {
  const { sync, wf, calls } = setup({ products: [shopifyProduct(1)], rateLimitOnce: true });
  await sync.importAll();
  assert.equal(wf.items.size, 1);
  assert.ok(calls.filter((call) => call.host === 'api.webflow.com').length >= 3);
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
  const tokenCalls = apis.calls.filter((call) => call.path === '/admin/oauth/access_token');
  assert.equal(tokenCalls.length, 1);
  assert.match(asString(tokenCalls[0]?.body, 'the token request'), /grant_type=client_credentials/);
  const admin = apis.calls.find((call) => call.path.startsWith('/admin/api/2026-07/'));
  assert.ok(admin);
  assert.equal(new Headers(admin.headers).get('X-Shopify-Access-Token'), 'shpat_fresh');
  assert.deepEqual(app.webhookSecrets, ['csecret'], 'app webhooks are signed with the client secret');
});
