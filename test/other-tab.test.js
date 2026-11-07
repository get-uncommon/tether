// Another tab of the same site changes the market or the cart: this tab follows it through the extras part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  cancelTimersAfterTests,
  cartFrom,
  detailOf,
  graphqlRequest,
  jsonResponse,
  operationName,
  product,
} from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

cancelTimersAfterTests();

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
});
// Without a cart or a product on the page, a market change sends nothing.
globalThis.fetch = async () => assert.fail('no request');

const { default: Tether } = await import('../src/index.ts');
/** @type {string[]} */
const reported = [];
await Tether.init({
  domain: 'shop.test',
  token: 't',
  autoMount: false,
  country: 'NL',
  onError: (_error, context) => reported.push(context),
});

const MARKET_KEY = 'tether:market:shop.test';
/** @param {string} newValue What the other tab stored. */
const otherTab = (newValue) => window.dispatchEvent(new window.StorageEvent('storage', { key: MARKET_KEY, newValue }));

test('a market another tab chose is followed, also after another script replaced window.Tether', async () => {
  Reflect.set(window, 'Tether', { setCountry: () => assert.fail('the replaced global was used') });
  otherTab('not json');
  otherTab(JSON.stringify({ country: 'US', language: null }));
  await waitFor(() => Tether.config.country === 'US', 'the market from the other tab');
  assert.equal(localStorage.getItem(MARKET_KEY), null, 'this tab stores nothing: the other tab did');
});

test('a value under the market key that is not a valid market is skipped, not reported', async () => {
  otherTab(JSON.stringify({ country: 'Germany' }));
  otherTab(JSON.stringify({ language: 'FR' }));
  otherTab(JSON.stringify({ country: 'BE' }));
  await waitFor(() => Tether.config.country === 'BE', 'the valid market after the invalid ones');
  assert.deepEqual(reported, []);
});

test('a reload for another tab’s cart change waits for the change in flight here, so its older answer never replaces it', async () => {
  const { fetch } = globalThis;
  const variant = product.variants.nodes[0]?.id ?? '';
  /** @param {number} quantity */
  const cartOf = (quantity) => cartFrom([{ merchandiseId: variant, quantity }]);
  let shopify = cartOf(1);
  /** @param {number} ms */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** @type {typeof fetch} */
  globalThis.fetch = async (_url, init) => {
    if (operationName(graphqlRequest(init).query) === 'Tether_cartLinesAdd') {
      await sleep(20);
      shopify = cartOf(2);
      return jsonResponse({ data: { cartLinesAdd: { cart: shopify, userErrors: [], warnings: [] } } });
    }
    // Shopify reads the cart as it is when the request arrives, and answers after the add would have.
    const read = shopify;
    await sleep(60);
    return jsonResponse({ data: { cart: read } });
  };
  document.body.innerHTML = '<span id="count" tether-cart-count></span>';
  localStorage.setItem('tether:cart:shop.test', shopify.id);
  let reloaded = false;
  const onUpdate = (/** @type {Event} */ event) => {
    reloaded ||= detailOf(event)['reason'] === 'load';
  };
  try {
    await Tether.cart.init();
    document.addEventListener('tether:cart-updated', onUpdate);
    const add = Tether.cart.add(variant);
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'tether:cart:shop.test:seen' }));
    await add;
    await waitFor(() => reloaded, 'the reload');
    assert.equal(Tether.cart.count, 2);
    assert.equal(document.getElementById('count')?.textContent, '2');
  } finally {
    document.removeEventListener('tether:cart-updated', onUpdate);
    globalThis.fetch = fetch;
    localStorage.clear();
    document.body.innerHTML = '';
  }
});

test('a burst of cart changes in another tab reloads the cart here once, behind the change in flight', async () => {
  const { fetch } = globalThis;
  const variant = product.variants.nodes[0]?.id ?? '';
  const cart = cartFrom([{ merchandiseId: variant, quantity: 1 }]);
  /** @type {string[]} */
  const operations = [];
  /** @type {typeof fetch} */
  globalThis.fetch = async (_url, init) => {
    const operation = operationName(graphqlRequest(init).query);
    operations.push(operation);
    if (operation === 'TetherCart') return jsonResponse({ data: { cart } });
    if (operation === 'Tether_cartLinesAdd') await new Promise((resolve) => setTimeout(resolve, 20));
    const mutation = operation.replace('Tether_', '');
    return jsonResponse({ data: { [mutation]: { cart, userErrors: [], warnings: [] } } });
  };
  localStorage.setItem('tether:cart:shop.test', cart.id);
  /** @param {string} key */
  const otherTabWrote = (key) => window.dispatchEvent(new window.StorageEvent('storage', { key }));
  try {
    await Tether.cart.init();
    operations.length = 0;
    const add = Tether.cart.add(variant);
    otherTabWrote('tether:cart:shop.test');
    otherTabWrote('tether:cart:shop.test:seen');
    otherTabWrote('tether:cart:shop.test:seen');
    await add;
    await waitFor(() => operations.length === 2, 'the reload');
    // Anything queued after the add has had its turn once a new task's turn comes.
    await Tether.cart.setNote('');
    assert.deepEqual(operations, ['Tether_cartLinesAdd', 'TetherCart', 'Tether_cartNoteUpdate']);
  } finally {
    globalThis.fetch = fetch;
    localStorage.clear();
  }
});

test('init() after a reload for another tab and another add were queued answers with that add applied', async () => {
  const { fetch } = globalThis;
  const variant = product.variants.nodes[0]?.id ?? '';
  /** @param {number} quantity */
  const cartOf = (quantity) => cartFrom([{ merchandiseId: variant, quantity }]);
  let shopify = cartOf(1);
  /** @type {typeof fetch} */
  globalThis.fetch = async (_url, init) => {
    if (operationName(graphqlRequest(init).query) === 'TetherCart') return jsonResponse({ data: { cart: shopify } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    shopify = cartOf(shopify.totalQuantity + 1);
    return jsonResponse({ data: { cartLinesAdd: { cart: shopify, userErrors: [], warnings: [] } } });
  };
  localStorage.setItem('tether:cart:shop.test', shopify.id);
  try {
    await Tether.cart.init();
    const first = Tether.cart.add(variant);
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'tether:cart:shop.test:seen' }));
    // The extras part, loaded by now, queues the reload once its import settles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = Tether.cart.add(variant);
    const loaded = await Tether.cart.init();
    assert.equal(loaded?.totalQuantity, 3);
    await Promise.all([first, second]);
    assert.equal(Tether.cart.count, 3);
  } finally {
    globalThis.fetch = fetch;
    localStorage.clear();
  }
});
