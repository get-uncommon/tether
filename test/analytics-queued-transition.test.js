// A page transition (Barba, Swup) before the analytics part has loaded: the product of the page left counts for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tether, cfg, rendered } from './astro-harness.js';
import { waitFor } from '../server/test/mocks.js';

test("analytics: a page transition before the part loaded sends each container's page view and its product's view", async () => {
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
  const { queueAnalyticsEvents, PAGE_LEFT, PAGE_MOUNT } = await import('../src/analytics-queue.ts');
  const analytics = await import('../src/analytics.ts');
  /** @type {() => void} */
  let loadPart = () => {};
  const queue = queueAnalyticsEvents(
    () =>
      new Promise((resolve) => {
        loadPart = () => {
          resolve(analytics);
        };
      }),
  );
  /** @returns {HTMLElement} A page container with a product, mounted. */
  const enter = () => {
    const container = document.createElement('main');
    container.innerHTML = '<div tether-product="coffee-box"></div>';
    document.body.append(container);
    // What `mount()` queues when `init()` made the queue.
    queue.push(new window.CustomEvent(PAGE_MOUNT, { detail: container }));
    Tether.mount(container);
    return container;
  };
  const first = enter();
  await rendered();
  queue.push(new window.Event(PAGE_LEFT));
  first.remove();
  enter();
  await rendered();
  assert.deepEqual(published, [], 'nothing before the part has loaded');
  loadPart();
  await waitFor(() => published.length === 4, 'the buffered page views');
  assert.deepEqual(published, ['page_viewed', 'product_viewed', 'page_viewed', 'product_viewed']);
});
