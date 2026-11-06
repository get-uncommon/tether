// The client-credentials token the Worker caches between runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShopify } from '../src/shopify.js';
import { memoryStore } from '../src/store.js';

const TOKEN = 'shpca_live-admin-token';

/** A store that hands out TOKEN for client credentials and answers the shop query. */
function fakeShopify() {
  const tokenRequests = [];
  const fetch = async (url, init) => {
    if (url.endsWith('/admin/oauth/access_token')) {
      tokenRequests.push(new URLSearchParams(init.body).get('client_secret'));
      return Response.json({ access_token: TOKEN, expires_in: 86399 });
    }
    assert.equal(init.headers['X-Shopify-Access-Token'], TOKEN);
    return Response.json({ data: { shop: { name: 'Shop', myshopifyDomain: 'shop.myshopify.com' } } });
  };
  return { fetch, tokenRequests };
}

const client = (store, fetch, clientSecret = 'client-secret') =>
  createShopify({ domain: 'shop.myshopify.com', clientId: 'id', clientSecret, tokenStore: store, fetch });

test('the cached Shopify token is sealed: KV never holds it readable, and the next run reuses it', async () => {
  const store = memoryStore();
  const shopify = fakeShopify();
  await client(store, shopify.fetch).shopName();

  const stored = store.map.get('shopify:token');
  assert.equal(typeof stored, 'string');
  assert.ok(!stored.includes(TOKEN), 'the token is not stored in the clear');

  await client(store, shopify.fetch).shopName();
  assert.equal(shopify.tokenRequests.length, 1, 'a second run reads the sealed token');
});

test('a cached token from another app secret, or one stored in the clear, is not used', async () => {
  const store = memoryStore({ 'shopify:token': { token: 'plain-old-token', expires: Date.now() + 3600e3 } });
  const shopify = fakeShopify();
  await client(store, shopify.fetch).shopName();
  assert.equal(shopify.tokenRequests.length, 1, 'a token cached in the clear is replaced');

  await client(store, shopify.fetch, 'rotated-secret').shopName();
  assert.deepEqual(shopify.tokenRequests, ['client-secret', 'rotated-secret']);
});
