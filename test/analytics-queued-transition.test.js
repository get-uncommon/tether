// A page transition (Barba, Swup) before the analytics part has started: the product of the page left counts for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tether, rendered } from './astro-harness.js';
import { graphqlRequest, jsonResponse, operationName } from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

/** @typedef {import('../src/analytics-shopify.ts').AnalyticsBus} AnalyticsBus */

test("analytics: a page transition before the part started sends each container's page view and its product's view", async () => {
  /**
   * `window.Shopify` without a bus, so the part sets up its own, and with consent given.
   *
   * @type {{ analytics?: AnalyticsBus, customerPrivacy: Record<string, unknown> }}
   */
  const shopify = { customerPrivacy: { consentStatus: 'loaded', analyticsProcessingAllowed: () => true } };
  Reflect.set(window, 'Shopify', shopify);
  /** @returns {AnalyticsBus | undefined} The bus the part set up, once it has started. */
  const partBus = () => shopify.analytics;
  // The part starts once Shopify has answered the shop id, which the test holds back meanwhile.
  /** @type {() => void} */
  let answerShopId = () => {};
  const shopFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (operationName(graphqlRequest(init).query) !== 'TetherShopId') return shopFetch(url, init);
    return new Promise((resolve) => {
      answerShopId = () => {
        resolve(jsonResponse({ data: { shop: { id: 'gid://shopify/Shop/1' } } }));
      };
    });
  };
  await Tether.init({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    country: 'NL',
    locale: 'nl-NL',
    analytics: { shopify: true },
  });
  /** @returns {HTMLElement} A page container with a product, mounted. */
  const enter = () => {
    const container = document.createElement('main');
    container.innerHTML = '<div tether-product="coffee-box"></div>';
    document.body.append(container);
    Tether.mount(container);
    return container;
  };
  const first = enter();
  await rendered();
  Tether.unmount();
  first.remove();
  enter();
  await rendered();
  assert.equal(partBus(), undefined, 'the part has not started');

  answerShopId();
  await waitFor(() => partBus() !== undefined, 'the bus');
  const bus = partBus();
  assert.ok(bus);
  /** @type {string[]} */
  const published = [];
  bus.addDestination({
    name: 'test',
    setup: ({ subscribe }) => {
      ['page_viewed', 'product_viewed'].forEach((event) => {
        subscribe(event, () => published.push(event));
      });
    },
  });
  await waitFor(() => published.length === 4, 'the buffered page views');
  assert.deepEqual(published, ['page_viewed', 'product_viewed', 'page_viewed', 'product_viewed']);
  globalThis.fetch = shopFetch;
});
