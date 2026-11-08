// Shopify's own analytics: the page views the analytics part publishes, and the bus that holds Shopify's events until
// the Customer Privacy API allows analytics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { cancelTimersAfterTests, graphqlRequest, jsonResponse, operationName, pageGlobals } from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';
import { cfg, resolveConfig } from '../src/config.ts';

cancelTimersAfterTests();

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://astro.test/' });
Object.assign(globalThis, pageGlobals(dom.window));
Object.assign(
  cfg,
  resolveConfig({ domain: 'shop.myshopify.com', token: 'public-token', analytics: { shopify: true } }),
);

/** @typedef {import('../src/analytics-shopify.ts').AnalyticsBus} AnalyticsBus */

/**
 * `window.Shopify`, which the tests set up as Shopify's scripts would.
 *
 * @typedef {{ analytics?: AnalyticsBus, customerPrivacy?: Record<string, unknown> }} ShopifyGlobal
 */

/** @param {ShopifyGlobal | undefined} shopify */
const setShopify = (shopify) => {
  Reflect.set(window, 'Shopify', shopify);
};

/** @returns {ShopifyGlobal} */
const shopifyGlobal = () => {
  /** @type {unknown} */
  const shopify = Reflect.get(window, 'Shopify');
  assert.ok(typeof shopify === 'object' && shopify !== null, 'window.Shopify is set');
  return shopify;
};

test("analytics: Astro's page-load for the landing page publishes no second page_viewed; one for a new body does", async () => {
  /** @type {string[]} */
  const published = [];
  setShopify({
    analytics: {
      getConfig: () => ({
        shop: { shopId: 'gid://shopify/Shop/1', channel: 'headless' },
        consent: { mode: 'no-banner' },
      }),
      publish: (event) => published.push(event),
      addDestination: () => () => {},
    },
  });
  const analytics = await import('../src/analytics.ts');
  /** @type {WeakMap<Event, HTMLElement>} */
  const bodies = new WeakMap();
  /** @returns {Event} An `astro:page-load` on the body the page has now, as the core's queue keeps it. */
  const pageLoad = () => {
    const event = new window.Event('astro:page-load');
    bodies.set(event, document.body);
    return event;
  };
  /** @type {Event[]} */
  const queue = [pageLoad()];
  await analytics.startAnalytics(queue, bodies, document.body);
  assert.deepEqual(published, ['page_viewed']);
  queue.push(pageLoad());
  assert.deepEqual(published, ['page_viewed'], 'the same body again');
  document.body.replaceWith(document.createElement('body'));
  queue.push(pageLoad());
  assert.deepEqual(published, ['page_viewed', 'page_viewed'], 'a client-side navigation');
  setShopify(undefined);
});

/**
 * The bus `startShopifyAnalytics` sets up, against a fake Storefront API that answers the shop id.
 *
 * @returns {Promise<AnalyticsBus>}
 */
async function startBus() {
  setShopify(undefined);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(operationName(graphqlRequest(init).query), 'TetherShopId');
    return jsonResponse({ data: { shop: { id: 'gid://shopify/Shop/1' } } });
  };
  try {
    const { startShopifyAnalytics } = await import('../src/analytics-shopify.ts');
    return await startShopifyAnalytics(() => false);
  } finally {
    globalThis.fetch = realFetch;
  }
}

/**
 * A destination, as shopify.js registers, that records the page_viewed payloads it gets.
 *
 * @param {AnalyticsBus} bus
 * @returns {Promise<{ urls: unknown[], tokens: unknown[] }>} Once the bus has it.
 */
async function addDestination(bus) {
  /** @type {unknown[]} */
  const urls = [];
  /** @type {unknown[]} */
  const tokens = [];
  bus.addDestination({
    name: 'test',
    setup: ({ subscribe }) => {
      subscribe('page_viewed', (payload, context) => {
        urls.push(payload['url']);
        tokens.push(context.getTrackingValues().uniqueToken);
      });
    },
  });
  // The bus adds a destination once its setup has settled.
  await Promise.resolve();
  await Promise.resolve();
  return { urls, tokens };
}

/**
 * Sets the visitor's consent as Shopify's privacy API reports it, and tells the bus as Shopify's script does.
 *
 * @param {Record<string, unknown>} privacy
 */
function setConsent(privacy) {
  const shopify = shopifyGlobal();
  shopify.customerPrivacy = { ...shopify.customerPrivacy, ...privacy };
  document.dispatchEvent(new window.Event('visitorConsentCollected'));
}

const allowed = {
  consentStatus: 'loaded',
  currentVisitorConsent: () => ({ analytics: 'yes' }),
  analyticsProcessingAllowed: () => true,
  __internal: { uniqueToken: () => 'unique', visitToken: () => 'visit' },
};

test('shopify analytics: nothing is delivered until consent allows analytics, then the buffer is replayed in order', async () => {
  const bus = await startBus();
  assert.equal(shopifyGlobal().analytics, bus);
  const delivered = await addDestination(bus);
  window.history.replaceState(null, '', '/first');
  bus.publish('page_viewed');
  window.history.replaceState(null, '', '/second');
  bus.publish('page_viewed');
  assert.deepEqual(delivered.urls, [], 'before the privacy API has loaded');
  setConsent({ ...allowed, consentStatus: undefined });
  assert.deepEqual(delivered.urls, [], 'while the privacy API is loading');
  setConsent({ ...allowed, currentVisitorConsent: () => ({ analytics: 'no' }) });
  assert.deepEqual(delivered.urls, [], 'the visitor declined analytics');
  setConsent({ ...allowed, analyticsProcessingAllowed: () => false });
  assert.deepEqual(delivered.urls, [], 'analytics processing not allowed');
  setConsent({
    ...allowed,
    analyticsProcessingAllowed: () => {
      throw new Error('still setting up');
    },
  });
  assert.deepEqual(delivered.urls, [], 'the privacy API threw');
  setConsent(allowed);
  assert.deepEqual(delivered.urls, ['https://astro.test/first', 'https://astro.test/second']);
  assert.deepEqual(delivered.tokens, ['unique', 'unique']);
  setConsent(allowed);
  assert.equal(delivered.urls.length, 2, 'each event is delivered once');
  window.history.replaceState(null, '', '/third');
  bus.publish('page_viewed');
  assert.equal(delivered.urls[2], 'https://astro.test/third', 'delivered as it is published');
  const late = await addDestination(bus);
  await waitFor(() => late.urls.length === 3, 'a late destination to get the buffered events');
});

test('shopify analytics: the buffer keeps the latest 500 events for a destination that registers late', async () => {
  const bus = await startBus();
  setConsent(allowed);
  for (let page = 0; page < 501; page += 1) {
    window.history.replaceState(null, '', `/page-${page}`);
    bus.publish('page_viewed');
  }
  const delivered = await addDestination(bus);
  await waitFor(() => delivered.urls.length === 500, 'the buffered events');
  assert.equal(delivered.urls[0], 'https://astro.test/page-1');
});
