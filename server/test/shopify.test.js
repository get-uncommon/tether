// The Shopify Admin client: query cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShopify, pageSizeFor } from '../src/index.ts';
import { createMockApis, shopifyProduct, instantSleep } from './mocks.js';

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
