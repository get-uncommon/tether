// The core's queue of analytics events while the part loads: dropped when it can't load, and when the visitor moves on
// before it has loaded, the buffered events of each page count for that page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tether, cfg, rendered } from './astro-harness.js';
import { waitFor } from '../server/test/mocks.js';

test('analytics: when the part fails to load, the queued events are dropped and no more are queued', async () => {
  const { queueAnalyticsEvents, PAGE_LEFT } = await import('../src/analytics-queue.ts');
  /** @type {(error: Error) => void} */
  let failLoad = () => {};
  const queue = queueAnalyticsEvents(
    () =>
      new Promise((_resolve, reject) => {
        failLoad = reject;
      }),
  );
  document.dispatchEvent(new window.CustomEvent('tether:cart-updated', { detail: { cart: null } }));
  document.dispatchEvent(new window.Event('astro:page-load'));
  assert.equal(queue.length, 2, 'queued while the part loads');
  failLoad(new Error('blocked by the page'));
  await waitFor(() => queue.length === 0, 'the queue to be emptied');
  document.dispatchEvent(new window.CustomEvent('tether:product-ready', { detail: {} }));
  queue.push(new window.Event(PAGE_LEFT));
  assert.equal(queue.length, 0);
});

test("analytics: an Astro navigation before the part loaded sends each page's view and its product's view", async () => {
  /** @type {string[]} */
  const published = [];
  Reflect.set(window, 'Shopify', {
    analytics: {
      getConfig: () => ({
        shop: { shopId: 'gid://shopify/Shop/1', channel: 'headless' },
        consent: { mode: 'no-banner' },
      }),
      /** @param {string} event */
      publish: (event) => published.push(event),
      addDestination: () => () => {},
    },
  });
  cfg.analytics = { shopify: true };
  const { queueAnalyticsEvents } = await import('../src/analytics-queue.ts');
  const analytics = await import('../src/analytics.ts');
  /** @type {() => void} */
  let loadPart = () => {};
  queueAnalyticsEvents(
    () =>
      new Promise((resolve) => {
        loadPart = () => {
          resolve(analytics);
        };
      }),
  );
  document.body.innerHTML = '<div tether-product="coffee-box"></div>';
  Tether.mount(document);
  await rendered();
  // Astro's first page-load is on the landing page.
  document.dispatchEvent(new window.Event('astro:page-load'));
  document.dispatchEvent(new window.Event('astro:before-swap'));
  const next = document.createElement('body');
  next.innerHTML = '<div tether-product="coffee-box"></div>';
  document.body.replaceWith(next);
  document.dispatchEvent(new window.Event('astro:page-load'));
  await rendered();
  assert.deepEqual(published, [], 'nothing before the part has loaded');
  loadPart();
  await waitFor(() => published.length === 4, 'the buffered page views');
  assert.deepEqual(published, ['page_viewed', 'product_viewed', 'page_viewed', 'product_viewed']);
});
