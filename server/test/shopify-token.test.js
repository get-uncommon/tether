// The client-credentials token the Worker caches between runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShopify } from '../src/shopify.ts';
import { memoryStore } from '../src/store.ts';
import { urlOf } from './mocks.js';

const TOKEN = 'shpca_live-admin-token';

/** A store that hands out TOKEN for client credentials and answers the shop query. */
function fakeShopify() {
  /** @type {(string | null)[]} */
  const tokenRequests = [];
  /** @type {typeof globalThis.fetch} */
  const fetch = async (url, init) => {
    if (urlOf(url).endsWith('/admin/oauth/access_token')) {
      const body = init?.body;
      assert.ok(typeof body === 'string', 'a form body');
      tokenRequests.push(new URLSearchParams(body).get('client_secret'));
      return Response.json({ access_token: TOKEN, expires_in: 86399 });
    }
    assert.equal(new Headers(init?.headers).get('X-Shopify-Access-Token'), TOKEN);
    return Response.json({ data: { shop: { name: 'Shop', myshopifyDomain: 'shop.myshopify.com' } } });
  };
  return { fetch, tokenRequests };
}

/**
 * @param {import('../src/store.ts').Store} store
 * @param {typeof globalThis.fetch} fetch
 */
const client = (store, fetch, clientSecret = 'client-secret') =>
  createShopify({ domain: 'shop.myshopify.com', clientId: 'id', clientSecret, tokenStore: store, fetch });

test('the cached Shopify token is sealed: KV never holds it readable, and the next run reuses it', async () => {
  const store = memoryStore();
  const shopify = fakeShopify();
  await client(store, shopify.fetch).shopName();

  const stored = store.map.get('shopify:token');
  assert.ok(typeof stored === 'string');
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

test('a cached token Shopify rejects is replaced in the store, so the next run does not hit the 401 again', async () => {
  const store = memoryStore();
  let issued = 'revoked-token';
  /** @type {string[]} */
  const tokenRequests = [];
  /** @type {(string | null)[]} */
  const rejected = [];
  /** @type {typeof globalThis.fetch} */
  const fetch = async (url, init) => {
    if (urlOf(url).endsWith('/admin/oauth/access_token')) {
      tokenRequests.push(issued);
      return Response.json({ access_token: issued, expires_in: 86399 });
    }
    const token = new Headers(init?.headers).get('X-Shopify-Access-Token');
    if (token !== TOKEN) {
      rejected.push(token);
      return new Response('Unauthorized', { status: 401 });
    }
    return Response.json({ data: { shop: { name: 'Shop', myshopifyDomain: 'shop.myshopify.com' } } });
  };
  // While Shopify still hands out the revoked token, the run fails, and that token stays cached.
  await assert.rejects(client(store, fetch).shopName(), /Shopify Admin API 401/);
  issued = TOKEN;
  rejected.length = 0;
  tokenRequests.length = 0;

  await client(store, fetch).shopName();
  assert.deepEqual(rejected, ['revoked-token'], 'the stored token is tried once');
  assert.deepEqual(tokenRequests, [TOKEN], 'and replaced by a fresh one');

  await client(store, fetch).shopName();
  assert.deepEqual(rejected, ['revoked-token'], 'the next run reads the fresh token from the store');
  assert.equal(tokenRequests.length, 1);
});
