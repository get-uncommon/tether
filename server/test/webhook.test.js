// The webhook endpoint's checks before any work: body size, signature, shop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleShopifyWebhook, MAX_WEBHOOK_BYTES } from '../src/webhook.ts';
import { bearerMatches, signShopify, verifyShopifyHmac } from '../src/hmac.ts';

const SHOP = 'shop.myshopify.com';
const neverSync = {
  syncById: () => Promise.reject(new Error('a refused webhook never reaches the sync')),
};

async function signed(body, { shop = SHOP } = {}) {
  const headers = { 'x-shopify-topic': 'products/update', 'x-shopify-hmac-sha256': await signShopify(body, 'whsec') };
  if (shop) headers['x-shopify-shop-domain'] = shop;
  return new Request('https://w.test/webhooks/shopify', { method: 'POST', body, headers });
}

test('a body over the limit is refused before its signature is checked', async () => {
  const body = 'x'.repeat(MAX_WEBHOOK_BYTES + 1);
  const { response } = await handleShopifyWebhook(await signed(body), {
    sync: neverSync,
    secrets: ['whsec'],
    shopDomain: SHOP,
  });
  assert.equal(response.status, 413);
});

test('without a configured store no webhook is accepted, however it is signed', async () => {
  const { response } = await handleShopifyWebhook(await signed('{"id":1}'), {
    sync: neverSync,
    secrets: ['whsec'],
    shopDomain: '',
  });
  assert.equal(response.status, 403);
});

test('signatures: wrong key, other body and non-base64 headers are refused', async () => {
  const signature = await signShopify('{"id":1}', 'whsec');
  assert.equal(await verifyShopifyHmac('{"id":1}', signature, 'whsec'), true);
  assert.equal(await verifyShopifyHmac('{"id":2}', signature, 'whsec'), false);
  assert.equal(await verifyShopifyHmac('{"id":1}', signature, 'other'), false);
  assert.equal(await verifyShopifyHmac('{"id":1}', '%%% not base64', 'whsec'), false);
});

test('the bearer secret must match exactly', async () => {
  const secret = 'a-long-random-sync-secret-123';
  assert.equal(await bearerMatches(`Bearer ${secret}`, secret), true);
  assert.equal(await bearerMatches(`Bearer ${secret}x`, secret), false);
  assert.equal(await bearerMatches(secret, secret), false);
  assert.equal(await bearerMatches(null, secret), false);
  assert.equal(await bearerMatches(`Bearer `, ''), false, 'no secret configured never matches');
});

test('a repeated X-Shopify-Webhook-Id is answered without syncing again; a new id syncs', async () => {
  const synced = [];
  const sync = {
    syncById: async (id) => {
      synced.push(id);
      return { action: 'unchanged' };
    },
    queueRetry: () => Promise.resolve(),
  };
  const delivery = async (webhookId) => {
    const request = await signed('{"id":7}');
    const headers = new Headers(request.headers);
    headers.set('x-shopify-webhook-id', webhookId);
    return new Request(request, { headers });
  };
  const options = { sync, secrets: ['whsec'], shopDomain: SHOP };
  const first = await handleShopifyWebhook(await delivery('wh-replay-1'), options);
  await first.task;
  const again = await handleShopifyWebhook(await delivery('wh-replay-1'), options);
  assert.equal(again.response.status, 200);
  assert.equal(again.task, undefined);
  const other = await handleShopifyWebhook(await delivery('wh-replay-2'), options);
  await other.task;
  assert.deepEqual(synced, ['7', '7']);
});

test('a forged repeat of a webhook id is refused by its signature before it can block the real delivery', async () => {
  const sync = { syncById: async () => ({ action: 'unchanged' }), queueRetry: () => Promise.resolve() };
  const forged = new Request('https://w.test/webhooks/shopify', {
    method: 'POST',
    body: '{"id":8}',
    headers: { 'x-shopify-webhook-id': 'wh-forged', 'x-shopify-hmac-sha256': 'nope', 'x-shopify-shop-domain': SHOP },
  });
  assert.equal(
    (await handleShopifyWebhook(forged, { sync, secrets: ['whsec'], shopDomain: SHOP })).response.status,
    401,
  );
  const request = await signed('{"id":8}');
  const headers = new Headers(request.headers);
  headers.set('x-shopify-webhook-id', 'wh-forged');
  const real = await handleShopifyWebhook(new Request(request, { headers }), {
    sync,
    secrets: ['whsec'],
    shopDomain: SHOP,
  });
  assert.ok(real.task, 'the real delivery still syncs');
});

/** A Cache API stand-in: what `caches.open()` gives a Worker, shared by every isolate of a data centre. */
function fakeCache() {
  const entries = new Map();
  return {
    entries,
    match: async (request) => entries.get(request.url)?.clone(),
    put: async (request, response) => {
      entries.set(request.url, response);
    },
  };
}

test("a delivery another isolate accepted is dropped through the data centre's cache", async () => {
  const synced = [];
  const sync = {
    syncById: async (id) => {
      synced.push(id);
      return { action: 'unchanged' };
    },
    queueRetry: () => Promise.resolve(),
  };
  const delivery = async () => {
    const request = await signed('{"id":9}');
    const headers = new Headers(request.headers);
    headers.set('x-shopify-webhook-id', 'wh-colo-1');
    return new Request(request, { headers });
  };
  const deliveries = fakeCache();
  const options = { sync, secrets: ['whsec'], shopDomain: SHOP, deliveries };
  const first = await handleShopifyWebhook(await delivery(), options);
  await first.task;
  const [[key, kept]] = deliveries.entries;
  assert.equal(new URL(key).host, 'w.test', "keyed on the Worker's own host");
  assert.match(kept.headers.get('cache-control'), /max-age=21600/, 'kept for six hours');

  // Another isolate has its own module state and the same cache.
  const { handleShopifyWebhook: otherIsolate } = await import('../src/webhook.ts?isolate-2');
  const again = await otherIsolate(await delivery(), options);
  assert.equal(again.response.status, 200);
  assert.equal(again.task, undefined, 'not synced twice');
  assert.deepEqual(synced, ['9']);
});

test('a failing delivery cache is logged and the webhook still synced', async () => {
  const warnings = [];
  const sync = { syncById: async () => ({ action: 'unchanged' }), queueRetry: () => Promise.resolve() };
  const broken = {
    match: () => Promise.reject(new Error('cache down')),
    put: () => Promise.reject(new Error('cache down')),
  };
  const request = await signed('{"id":10}');
  const headers = new Headers(request.headers);
  headers.set('x-shopify-webhook-id', 'wh-colo-broken');
  const { task } = await handleShopifyWebhook(new Request(request, { headers }), {
    sync,
    secrets: ['whsec'],
    shopDomain: SHOP,
    deliveries: broken,
    log: { warn: (message) => warnings.push(message) },
  });
  assert.ok(task, 'synced');
  assert.match(warnings[0], /delivery cache failed \(cache down\)/);
});
