// Requests that never finish, against a local server that takes them and never answers: requestTimeout ends each one
// as a network error, so nothing waits on it for ever.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { JSDOM } from 'jsdom';
import { listenForFetch, urlOf } from '../server/test/mocks.js';
import {
  cancelTimersAfterTests,
  captureTetherWarnings,
  cartFrom,
  graphqlRequest,
  jsonResponse,
  operationName,
  product,
} from './fixtures.js';

cancelTimersAfterTests();

captureTetherWarnings();

/** Node's own fetch, which the stalled server gets; the other cart requests go to the fake further down. */
const nodeFetch = globalThis.fetch;

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
});

const { configure, resolveConfig } = await import('../src/config.ts');
const { Cart } = await import('../src/cart.ts');
const { request, hasData } = await import('../src/client.ts');

const MUTATION = 'mutation Add($cartId: ID!) { cartLinesAdd(cartId: $cartId, lines: []) { cart { id } } }';
const TIMEOUT_MS = 50;
/** The message of the abort reason `requestTimeout` ends a fetch with. */
const TIMED_OUT = /^Network error: signal timed out$/;

/** How each request the server gets stalls: before its headers, or partway through its body. */
let stall = /** @type {'answer' | 'body'} */ ('answer');
const server = createServer((_req, res) => {
  if (stall === 'body') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"data":');
  }
});
/** @type {typeof fetch} */
let toStalledServer = () => Promise.reject(new Error('the server is not listening yet'));

before(async () => {
  const port = await listenForFetch(server);
  toStalledServer = (_url, init) => nodeFetch(`http://127.0.0.1:${String(port)}/`, init);
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

/**
 * The requests sent to the stalled server, counted as they are sent: the server may take a timed-out one only after
 * the next test has begun.
 */
let sent = 0;

/** @param {number} retries */
const stalledConfig = (retries) => ({
  ...resolveConfig({ domain: 'stalled.test', token: 't', maxAge: 0, retries, requestTimeout: TIMEOUT_MS }),
  /** @type {typeof fetch} */
  fetch: (url, init) => {
    sent += 1;
    return toStalledServer(url, init);
  },
});

test(
  'a request that gets no answer, or no whole body, within requestTimeout fails as NETWORK',
  { timeout: 10_000 },
  async () => {
    for (const how of /** @type {const} */ (['answer', 'body'])) {
      stall = how;
      await assert.rejects(request(stalledConfig(0), MUTATION, {}, hasData, { operation: 'mutation' }), {
        code: 'NETWORK',
        message: TIMED_OUT,
      });
    }
  },
);

test('a query that timed out is sent again, a mutation is not', { timeout: 10_000 }, async () => {
  stall = 'answer';
  sent = 0;
  await assert.rejects(request(stalledConfig(1), '{ shop { name } }', {}, hasData), { code: 'NETWORK' });
  assert.equal(sent, 2, 'the query is sent again once');
  sent = 0;
  await assert.rejects(request(stalledConfig(1), MUTATION, {}, hasData, { operation: 'mutation' }), {
    code: 'NETWORK',
  });
  assert.equal(sent, 1, 'the mutation is not');
});

/** Timers Node has pending, which a request's timeout adds to until it is cleared. */
const pendingTimers = () => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;

test(
  'without AbortSignal.timeout, as in Safari 15, requests still time out and clear their timer',
  { timeout: 10_000 },
  async () => {
    const timeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
    assert.ok(timeout);
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
    try {
      stall = 'answer';
      await assert.rejects(request(stalledConfig(0), MUTATION, {}, hasData, { operation: 'mutation' }), {
        code: 'NETWORK',
        message: TIMED_OUT,
      });
      const before = pendingTimers();
      const answered = {
        ...resolveConfig({ domain: 'answered.test', token: 't', maxAge: 0, retries: 0, requestTimeout: 60_000 }),
        fetch: () => Promise.resolve(jsonResponse({ data: { shop: { name: 'Shop' } } })),
      };
      assert.deepEqual(await request(answered, '{ shop { name } }', {}, hasData), { shop: { name: 'Shop' } });
      assert.equal(pendingTimers(), before, 'no timer is left pending once the answer is read');
    } finally {
      Object.defineProperty(AbortSignal, 'timeout', timeout);
    }
  },
);

/** @type {string[]} */
const ops = [];
/** @type {Partial<Record<string, () => unknown>>} op name -> response body; ops without one go to the stalled server */
let answers = {};
/**
 * @param {RequestInfo | URL} url
 * @param {RequestInit} [init]
 */
globalThis.fetch = async (url, init) => {
  const op = operationName(graphqlRequest(init).query);
  ops.push(op);
  const answer = answers[op];
  return answer ? jsonResponse(answer()) : toStalledServer(url, init);
};

beforeEach(() => {
  configure({ domain: 'shop.test', token: 't', autoMount: false, requestTimeout: TIMEOUT_MS });
  localStorage.clear();
  ops.length = 0;
  answers = {};
});

test(
  'a cart change that never gets an answer fails, the cart loads again, and the changes queued behind it run',
  { timeout: 10_000 },
  async () => {
    stall = 'answer';
    const variant = product.variants.nodes[0]?.id ?? '';
    const twoOfIt = cartFrom([{ merchandiseId: variant, quantity: 2 }]);
    localStorage.setItem('tether:cart:shop.test', 'gid://shopify/Cart/abc');
    answers['TetherCart'] = () => ({ data: { cart: cartFrom([{ merchandiseId: variant, quantity: 1 }]) } });
    await Cart.init();
    ops.length = 0;
    // Shopify made the change; only its answer never came.
    answers['TetherCart'] = () => ({ data: { cart: twoOfIt } });
    answers['Tether_cartNoteUpdate'] = () => ({
      data: { cartNoteUpdate: { cart: twoOfIt, userErrors: [], warnings: [] } },
    });
    const stalled = Cart.add(variant);
    const queued = Cart.setNote('hi');
    await assert.rejects(stalled, { code: 'NETWORK', message: TIMED_OUT });
    await queued;
    assert.deepEqual(
      ops,
      ['Tether_cartLinesAdd', 'TetherCart', 'Tether_cartNoteUpdate'],
      'the add is not sent again, the cart is loaded again, then the queued change runs',
    );
    assert.equal(Cart.count, 2);
  },
);

test(
  'a Worker that never answers fails as NETWORK within requestTimeout, and checkout goes on without the login',
  { timeout: 10_000 },
  async () => {
    const { serverCheckoutUrl, serverFetch } = await import('../src/account/server-client.ts');
    /** @type {string[]} */
    const reported = [];
    configure({
      domain: 'shop.test',
      token: 't',
      autoMount: false,
      requestTimeout: TIMEOUT_MS,
      account: { server: '/_tether/account' },
      onError: (_error, context) => reported.push(context),
    });
    const storefront = globalThis.fetch;
    /** @type {typeof fetch} */
    globalThis.fetch = (url, init) =>
      urlOf(url).includes('/_tether/account/') ? toStalledServer(url, init) : storefront(url, init);
    try {
      for (const how of /** @type {const} */ (['answer', 'body'])) {
        stall = how;
        await assert.rejects(serverFetch('/me'), { code: 'NETWORK', message: TIMED_OUT });
      }
      stall = 'answer';
      localStorage.setItem('tether:cart:shop.test', 'gid://shopify/Cart/abc');
      const variant = product.variants.nodes[0]?.id ?? '';
      answers['TetherCart'] = () => ({ data: { cart: cartFrom([{ merchandiseId: variant, quantity: 1 }]) } });
      answers['TetherCheckout'] = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
      await Cart.init();
      Cart.setCheckoutResolver(serverCheckoutUrl);
      assert.equal(await Cart.checkout('_self'), 'https://shop.test/checkouts/1');
      assert.deepEqual(reported, ['account checkout']);
    } finally {
      Cart.setCheckoutResolver(null);
      globalThis.fetch = storefront;
    }
  },
);
