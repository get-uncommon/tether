// The webhook endpoint's checks before any work: body size, signature, shop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleShopifyWebhook, MAX_WEBHOOK_BYTES } from '../src/webhook.js';
import { bearerMatches, signShopify, verifyShopifyHmac } from '../src/hmac.js';

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
