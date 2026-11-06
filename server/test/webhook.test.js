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
