// The cart on its own: status, queue, expired carts, failed changes and checkout.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  captureTetherWarnings,
  cartFrom,
  detailOf,
  find,
  graphqlRequest,
  attributesAt,
  jsonResponse,
  linesAt,
  okWithDroppedBody,
  operationName,
  product,
} from './fixtures.js';
import { asString, listAt, recordAt, stringAt, waitFor } from '../server/test/mocks.js';

// The failures these tests cause on purpose are checked through onError, states and events, not the console.
captureTetherWarnings();

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
});

const { configure } = await import('../src/config.ts');
const { Cart } = await import('../src/cart.ts');
const { serial } = await import('../src/cart/store.ts');
const { isCartGone } = await import('../src/cart/mutations.ts');
const { TetherError } = await import('../src/client.ts');

const KEY = 'tether:cart:shop.test';
const VARIANT = product.variants.nodes[0]?.id ?? '';
/** @type {{ error: unknown, context: string }[]} */
const reported = [];
/** @typedef {ReturnType<typeof graphqlRequest>['variables']} Variables */
/** @type {{ op: string, variables: Variables }[]} */
const calls = [];
/** @type {Partial<Record<string, (variables: Variables) => unknown>>} op name -> response body, or a Promise of one */
let answers = {};

/**
 * @param {RequestInfo | URL} _url
 * @param {RequestInit} [init]
 */
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  const op = operationName(query);
  calls.push({ op, variables });
  const answer = answers[op];
  if (!answer) throw new Error(`unexpected op ${op}`);
  const body = await answer(variables);
  return body instanceof Response ? body : jsonResponse(body);
};

/**
 * @param {string} name
 * @param {import('../src/cart/store.ts').ShopifyCart | null} cart
 * @param {import('../src/client.ts').UserError[]} [userErrors]
 */
const payload = (name, cart, userErrors = []) => ({ data: { [name]: { cart, userErrors, warnings: [] } } });
const oneLine = (quantity = 1) => cartFrom([{ merchandiseId: VARIANT, quantity }]);
/**
 * Loads `cart` as the saved cart, the way a page with a cart starts.
 *
 * @param {import('../src/cart/store.ts').ShopifyCart | null} cart
 */
const loadSaved = async (cart) => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  answers['TetherCart'] = () => ({ data: { cart } });
  await Cart.init();
};
const deferred = () => {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

beforeEach(() => {
  configure({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    onError: (error, context) => reported.push({ error, context }),
  });
  localStorage.clear();
  reported.length = 0;
  calls.length = 0;
  answers = {};
  Cart.setCheckoutResolver(null);
  document.body.innerHTML = '';
});

// The status union: these run first, while the cart is still unknown.
test('status: unknown before the first load, empty without a saved cart', async () => {
  assert.equal(Cart.status.kind, 'unknown');
  assert.equal(Cart.loaded, false);
  assert.equal(Cart.state, null);
  assert.equal(await Cart.init(), null);
  assert.deepEqual(Cart.status, { kind: 'empty' });
  assert.equal(Cart.loaded, true);
  assert.equal(Cart.count, 0);
  assert.deepEqual(Cart.lines, []);
  assert.equal(calls.length, 0, 'no request without a saved cart');
});

test('status: ready with the saved cart; error (cart kept) when Shopify cannot be reached', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  answers['TetherCart'] = () => ({ data: { cart: oneLine(2) } });
  await Cart.init();
  assert.equal(Cart.status.kind, 'ready');
  assert.equal(Cart.count, 2);
  assert.equal(Cart.lastError, null);

  answers['TetherCart'] = () => ({ errors: [{ message: 'Internal error' }] });
  await Cart.init();
  assert.equal(Cart.status.kind, 'error');
  assert.match(String(Cart.lastError), /Internal error/);
  assert.equal(Cart.state, null);
  assert.equal(Cart.id(), 'gid://shopify/Cart/abc', 'the saved cart is probably fine');
  assert.equal(reported.at(-1)?.context, 'cart load failed');
});

test('status: a failed change shows cart-error and keeps the cart; the next success clears it', async () => {
  document.body.innerHTML = '<p id="err" tether-show="cart-error">x</p>';
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  answers['TetherCart'] = () => ({ data: { cart: oneLine(1) } });
  await Cart.init();
  /** @type {unknown[]} */
  const errors = [];
  document.addEventListener('tether:cart-error', (event) => errors.push(detailOf(event)['error']));
  answers['Tether_cartLinesAdd'] = () => payload('cartLinesAdd', null, [{ field: ['lines'], message: 'Sold out' }]);
  await assert.rejects(Cart.add(VARIANT), /Sold out/);
  assert.equal(Cart.status.kind, 'error');
  assert.equal(Cart.count, 1, 'the cart as Shopify last sent it');
  assert.equal(errors.length, 1);
  assert.notEqual(find('#err').style.display, 'none');

  answers['Tether_cartLinesAdd'] = () => payload('cartLinesAdd', oneLine(2));
  await Cart.add(VARIANT);
  assert.equal(Cart.status.kind, 'ready');
  assert.equal(Cart.lastError, null);
  assert.equal(find('#err').style.display, 'none');
});

test('serial: each task starts once the one before has settled, failed or not', async () => {
  const run = serial();
  /** @type {string[]} */
  const order = [];
  const first = deferred();
  const failing = run(async () => {
    order.push('a start');
    await first.promise;
    throw new Error('a failed');
  });
  const second = run(async () => {
    order.push('b start');
    return 'b';
  });
  // Every task already queued has run by the next macrotask: b would have started by then.
  await new Promise(setImmediate);
  assert.deepEqual(order, ['a start'], 'b waits for a');
  first.resolve();
  await assert.rejects(failing, /a failed/);
  assert.equal(await second, 'b');
  assert.deepEqual(order, ['a start', 'b start']);
});

test('queue: quick changes reach Shopify one after another, each with the cart as it is by then', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  const slow = deferred();
  /** @type {import('../src/cart/store.ts').Attribute[]} */
  let attributes = [];
  answers['Tether_cartAttributesUpdate'] = async (variables) => {
    if (!attributes.length) await slow.promise;
    attributes = attributesAt(variables, 'attributes');
    return payload('cartAttributesUpdate', { ...oneLine(), attributes });
  };
  const first = Cart.setAttributes({ gift: 'yes' });
  const second = Cart.setAttributes({ wrap: 'blue' });
  await waitFor(() => calls.length > 0, 'the first change to be sent');
  assert.equal(calls.length, 1, 'the second change waits');
  slow.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls[1]?.variables['attributes'], [
    { key: 'gift', value: 'yes' },
    { key: 'wrap', value: 'blue' },
  ]);
});

test('expired cart: a query answering cart: null forgets the saved cart', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/old');
  answers['TetherCart'] = () => ({ data: { cart: null } });
  await Cart.init();
  assert.deepEqual(Cart.status, { kind: 'empty' });
  assert.equal(Cart.id(), null);
  assert.equal(reported.length, 0, 'an expired cart is not a failure');
});

test('a saved value that is not a cart id is forgotten unsent, and the next add starts a new cart', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc") { id } } #');
  assert.equal(Cart.id(), null);
  assert.equal(localStorage.getItem(KEY), null);
  await Cart.init();
  assert.equal(calls.length, 0);

  localStorage.setItem(KEY, 'not a cart');
  answers['Tether_cartCreate'] = () => payload('cartCreate', oneLine());
  await Cart.add(VARIANT);
  assert.deepEqual(
    calls.map((call) => call.op),
    ['Tether_cartCreate'],
  );
  assert.equal(Cart.id(), 'gid://shopify/Cart/abc');
  localStorage.setItem(KEY, 'gid://shopify/Cart/c1-7a2abe82?key=2c3f9d');
  assert.equal(Cart.id(), 'gid://shopify/Cart/c1-7a2abe82?key=2c3f9d', 'a cart id with its key is kept');
});

test('a change without a clear answer is not sent again, and the cart is loaded again to show what Shopify has', async () => {
  const lostAnswers = [
    { code: 'HTTP_504', lost: () => new Response('Gateway Timeout', { status: 504 }) },
    {
      code: 'INVALID_RESPONSE',
      lost: () => jsonResponse({ data: { cartLinesAdd: { cart: { id: 1 } } } }),
    },
    {
      code: 'SERVER_ERROR',
      lost: () =>
        jsonResponse({ errors: [{ message: 'Internal error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }),
    },
    { code: 'SERVER_ERROR', lost: () => jsonResponse({ data: null, errors: [{ message: 'Internal error' }] }) },
    {
      code: 'NETWORK',
      lost: () => {
        throw new TypeError('Failed to fetch');
      },
    },
    { code: 'NETWORK', lost: () => okWithDroppedBody() },
  ];
  for (const { code, lost } of lostAnswers) {
    await loadSaved(oneLine());
    calls.length = 0;
    answers['Tether_cartLinesAdd'] = lost;
    // Shopify made the change; only its answer was lost.
    answers['TetherCart'] = () => ({ data: { cart: oneLine(2) } });
    await assert.rejects(Cart.add(VARIANT), { code });
    assert.deepEqual(
      calls.map((call) => call.op),
      ['Tether_cartLinesAdd', 'TetherCart'],
      code,
    );
    assert.equal(Cart.count, 2, `${code}: the cart Shopify has`);
    assert.equal(Cart.status.kind, 'error', `${code}: the change still failed`);
  }
  answers['TetherCart'] = () => new Response('{}', { status: 400 });
  await assert.rejects(Cart.add(VARIANT), { code: 'NETWORK' });
  assert.equal(Cart.count, 2, 'a failed reload keeps the cart');
  assert.equal(reported.at(-1)?.context, 'cart reload after a failed change');
});

test('a clear refusal (user errors, a 4xx) loads nothing more: the cart stays as Shopify last sent it', async () => {
  const refusals = [
    () => payload('cartLinesAdd', null, [{ field: ['lines'], message: 'Sold out' }]),
    () => new Response('{}', { status: 400 }),
  ];
  for (const refusal of refusals) {
    await loadSaved(oneLine());
    calls.length = 0;
    answers['Tether_cartLinesAdd'] = refusal;
    await assert.rejects(Cart.add(VARIANT));
    assert.deepEqual(
      calls.map((call) => call.op),
      ['Tether_cartLinesAdd'],
    );
    assert.equal(Cart.count, 1);
  }
});

test('clear() removes the lines the cart has when its turn comes, including one added just before it', async () => {
  await loadSaved(null);
  calls.length = 0;
  answers['Tether_cartCreate'] = () => payload('cartCreate', oneLine());
  answers['Tether_cartLinesRemove'] = () => payload('cartLinesRemove', cartFrom([]));
  const added = Cart.add(VARIANT);
  const cleared = Cart.clear();
  await added;
  assert.equal((await cleared)?.totalQuantity, 0);
  assert.deepEqual(
    calls.map((call) => call.op),
    ['Tether_cartCreate', 'Tether_cartLinesRemove'],
  );
  assert.deepEqual(calls[1]?.variables['lineIds'], ['gid://shopify/CartLine/1']);
  assert.equal(Cart.count, 0);
});

test('a cart load is retried after a 5xx: it changes nothing', async () => {
  await loadSaved(oneLine());
  calls.length = 0;
  let loads = 0;
  answers['TetherCart'] = () => {
    loads += 1;
    return loads === 1 ? new Response('Gateway Timeout', { status: 504 }) : { data: { cart: oneLine(2) } };
  };
  await Cart.init();
  assert.equal(Cart.count, 2);
  assert.deepEqual(
    calls.map((call) => call.op),
    ['TetherCart', 'TetherCart'],
  );
});

test('forgetSaved: drops the saved cart and shows an empty one, as a load of no cart does', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  answers['TetherCart'] = () => ({ data: { cart: oneLine(2) } });
  await Cart.init();
  assert.equal(Cart.count, 2);
  /** @type {unknown[]} */
  const updates = [];
  /** @param {Event} event */
  const listener = (event) => updates.push(detailOf(event));
  document.addEventListener('tether:cart-updated', listener);
  Cart.forgetSaved();
  document.removeEventListener('tether:cart-updated', listener);
  assert.equal(Cart.id(), null);
  assert.equal(localStorage.getItem(KEY), null);
  assert.deepEqual(Cart.status, { kind: 'empty' });
  assert.equal(Cart.state, null);
  assert.equal(Cart.count, 0);
  assert.deepEqual(updates, [{ cart: null, reason: 'load' }]);
  assert.equal(calls.length, 1, 'Shopify is not asked');
});

test('expired cart: a cartId user error creates a new cart with the same lines', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/old');
  answers['Tether_cartLinesAdd'] = () =>
    payload('cartLinesAdd', null, [{ field: ['cartId'], message: 'The specified cart does not exist.' }]);
  answers['Tether_cartCreate'] = (variables) =>
    payload('cartCreate', cartFrom(linesAt(recordAt(variables, 'input'), 'lines')));
  const cart = await Cart.add(VARIANT, 3);
  assert.equal(cart.totalQuantity, 3);
  assert.deepEqual(
    calls.map((call) => call.op),
    ['Tether_cartLinesAdd', 'Tether_cartCreate'],
  );
  assert.equal(Cart.id(), 'gid://shopify/Cart/abc');
});

test('expired cart: a GraphQL error naming the cart id is recognised by its message', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/old');
  answers['Tether_cartNoteUpdate'] = () => ({ errors: [{ message: 'The specified cart does not exist.' }] });
  answers['Tether_cartCreate'] = (variables) =>
    payload('cartCreate', { ...oneLine(), note: stringAt(recordAt(variables, 'input'), 'note') });
  const cart = await Cart.setNote('hello');
  assert.ok(cart);
  assert.equal(cart.note, 'hello');
});

test('expired cart: an error about a line is not mistaken for a missing cart', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  answers['Tether_cartLinesAdd'] = () =>
    payload('cartLinesAdd', null, [
      { field: ['lines', '0', 'merchandiseId'], message: 'The merchandise does not exist.' },
    ]);
  await assert.rejects(Cart.add(VARIANT), /merchandise does not exist/);
  assert.ok(!calls.some((call) => call.op === 'Tether_cartCreate'));
  assert.equal(Cart.id(), 'gid://shopify/Cart/abc');
});

test('isCartGone: the network, the token and other errors keep the saved cart', () => {
  assert.equal(isCartGone(new TetherError('Network error', { code: 'NETWORK' })), false);
  assert.equal(isCartGone(new TetherError('HTTP 401', { status: 401 })), false);
  assert.equal(isCartGone(new Error('does not exist')), false);
  assert.equal(isCartGone(new TetherError('x', { userErrors: [{ field: ['cartId'], message: 'x' }] })), true);
});

test('checkout: a failing account step is reported and Shopify checkout is used instead', async () => {
  await loadSaved(oneLine());
  answers['TetherCheckout'] = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
  Cart.setCheckoutResolver(async () => {
    throw new Error('account server down');
  });
  /** @type {string[]} */
  const urls = [];
  document.addEventListener('tether:checkout', (event) => urls.push(stringAt(detailOf(event), 'url')), { once: true });
  const url = await Cart.checkout('_self');
  assert.equal(url, 'https://shop.test/checkouts/1');
  assert.deepEqual(urls, [url]);
  assert.deepEqual(
    reported.map((report) => report.context),
    ['account checkout'],
  );
});

test("checkout: the account's URL wins, and the cart's unneeded request failing is not a failure", async () => {
  await loadSaved(oneLine());
  answers['TetherCheckout'] = () => ({ errors: [{ message: 'Internal error' }] });
  Cart.setCheckoutResolver(async () => 'https://shop.test/checkouts/c/2?key=k');
  const url = await Cart.checkout('_self');
  assert.equal(url, 'https://shop.test/checkouts/c/2?key=k&logged_in=true');
  assert.equal(reported.length, 0);
});

test("checkout: null from the account uses the cart's URL, without the login parameter", async () => {
  await loadSaved(oneLine());
  answers['TetherCheckout'] = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
  Cart.setCheckoutResolver(async () => null);
  assert.equal(await Cart.checkout('_self'), 'https://shop.test/checkouts/1');
  Cart.setCheckoutResolver(null);
  assert.equal(await Cart.checkout('_self'), 'https://shop.test/checkouts/1', 'cleared: the cart decides');
  assert.equal(reported.length, 0);
});

test('checkout: without any checkout URL the failure is reported and nothing opens', async () => {
  await loadSaved(oneLine());
  answers['TetherCheckout'] = () => ({ errors: [{ message: 'Internal error' }] });
  assert.equal(await Cart.checkout('_self'), null);
  assert.deepEqual(
    reported.map((report) => report.context),
    ['checkout failed'],
  );
});

test('applyDiscount: a refused code is removed again; a failed removal is reported, the rejection says why', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  let removals = 0;
  answers['Tether_cartDiscountCodesUpdate'] = (variables) => {
    const codes = listAt(variables, 'discountCodes').map((code, i) => asString(code, `discountCodes[${i}]`));
    if (!codes.length) {
      removals += 1;
      return new Response('{}', { status: 400 });
    }
    const discountCodes = codes.map((code) => ({ code, applicable: false }));
    return payload('cartDiscountCodesUpdate', { ...oneLine(), discountCodes });
  };
  await assert.rejects(
    Cart.applyDiscount('NOPE'),
    (error) => error instanceof TetherError && error.code === 'INVALID_DISCOUNT',
  );
  assert.equal(removals, 1);
  assert.deepEqual(
    reported.map((report) => report.context),
    ['removing a discount code Shopify refused'],
  );
});

test('lastError is read-only: the store decides it', () => {
  // Test files are modules, so strict: assigning a getter-only property throws.
  assert.throws(() => {
    // @ts-expect-error -- the assignment this test expects to throw
    Cart.lastError = new Error('x');
  }, TypeError);
});
