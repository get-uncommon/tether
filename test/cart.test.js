// The cart on its own: status, queue, expired carts, checkout and the drawer's focus trap.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { product, cartFrom } from './fixtures.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
});

const { configure } = await import('../src/config.js');
const { Cart, trapFocus } = await import('../src/cart.js');
const { serial } = await import('../src/cart/store.js');
const { isCartGone } = await import('../src/cart/mutations.js');
const { TetherError } = await import('../src/client.js');
const { isGreaterAmount } = await import('../src/amounts.js');

const KEY = 'tether:cart:shop.test';
const VARIANT = product.variants.nodes[0].id;
const reported = [];
const calls = [];
/** op name -> (variables) => response body, or a Promise of one */
let answers = {};

globalThis.fetch = async (_url, init) => {
  const { query, variables } = JSON.parse(init.body);
  const op = query.match(/(?:query|mutation)\s+(\w+)/)[1];
  calls.push({ op, variables });
  const answer = answers[op];
  if (!answer) throw new Error(`unexpected op ${op}`);
  const body = await answer(variables);
  return { ok: true, status: 200, json: async () => body };
};

const payload = (name, cart, userErrors = []) => ({ data: { [name]: { cart, userErrors, warnings: [] } } });
const oneLine = (quantity = 1) => cartFrom([{ merchandiseId: VARIANT, quantity }]);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
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
  Cart.setCustomer({ accessToken: null, beforeCheckout: null });
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
  answers.TetherCart = () => ({ data: { cart: oneLine(2) } });
  await Cart.init();
  assert.equal(Cart.status.kind, 'ready');
  assert.equal(Cart.count, 2);
  assert.equal(Cart.lastError, null);

  answers.TetherCart = () => ({ errors: [{ message: 'Internal error' }] });
  await Cart.init();
  assert.equal(Cart.status.kind, 'error');
  assert.match(Cart.lastError.message, /Internal error/);
  assert.equal(Cart.state, null);
  assert.equal(Cart.id(), 'gid://shopify/Cart/abc', 'the saved cart is probably fine');
  assert.equal(reported.at(-1).context, 'cart load failed');
});

test('status: a failed change shows cart-error and keeps the cart; the next success clears it', async () => {
  document.body.innerHTML = '<p id="err" tether-show="cart-error">x</p>';
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  answers.TetherCart = () => ({ data: { cart: oneLine(1) } });
  await Cart.init();
  const errors = [];
  document.addEventListener('tether:cart-error', (e) => errors.push(e.detail.error));
  answers.Tether_cartLinesAdd = () => payload('cartLinesAdd', null, [{ field: ['lines'], message: 'Sold out' }]);
  await assert.rejects(Cart.add(VARIANT), /Sold out/);
  assert.equal(Cart.status.kind, 'error');
  assert.equal(Cart.count, 1, 'the cart as Shopify last sent it');
  assert.equal(errors.length, 1);
  assert.notEqual(document.getElementById('err').style.display, 'none');

  answers.Tether_cartLinesAdd = () => payload('cartLinesAdd', oneLine(2));
  await Cart.add(VARIANT);
  assert.equal(Cart.status.kind, 'ready');
  assert.equal(Cart.lastError, null);
  assert.equal(document.getElementById('err').style.display, 'none');
});

test('serial: each task starts once the one before has settled, failed or not', async () => {
  const run = serial();
  const order = [];
  const first = deferred();
  const a = run(async () => {
    order.push('a start');
    await first.promise;
    throw new Error('a failed');
  });
  const b = run(async () => {
    order.push('b start');
    return 'b';
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(order, ['a start'], 'b waits for a');
  first.resolve();
  await assert.rejects(a, /a failed/);
  assert.equal(await b, 'b');
  assert.deepEqual(order, ['a start', 'b start']);
});

test('queue: quick changes reach Shopify one after another, each with the cart as it is by then', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  const slow = deferred();
  let attributes = [];
  answers.Tether_cartAttributesUpdate = async (variables) => {
    if (!attributes.length) await slow.promise;
    attributes = variables.attributes;
    return payload('cartAttributesUpdate', { ...oneLine(), attributes });
  };
  const first = Cart.setAttributes({ gift: 'yes' });
  const second = Cart.setAttributes({ wrap: 'blue' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls.length, 1, 'the second change waits');
  slow.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls[1].variables.attributes, [
    { key: 'gift', value: 'yes' },
    { key: 'wrap', value: 'blue' },
  ]);
});

test('expired cart: a query answering cart: null forgets the saved cart', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/old');
  answers.TetherCart = () => ({ data: { cart: null } });
  await Cart.init();
  assert.deepEqual(Cart.status, { kind: 'empty' });
  assert.equal(Cart.id(), null);
  assert.equal(reported.length, 0, 'an expired cart is not a failure');
});

test('expired cart: a cartId user error creates a new cart with the same lines', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/old');
  answers.Tether_cartLinesAdd = () =>
    payload('cartLinesAdd', null, [{ field: ['cartId'], message: 'The specified cart does not exist.' }]);
  answers.Tether_cartCreate = (variables) => payload('cartCreate', cartFrom(variables.input.lines));
  const cart = await Cart.add(VARIANT, 3);
  assert.equal(cart.totalQuantity, 3);
  assert.deepEqual(
    calls.map((c) => c.op),
    ['Tether_cartLinesAdd', 'Tether_cartCreate'],
  );
  assert.equal(Cart.id(), 'gid://shopify/Cart/abc');
});

test('expired cart: a GraphQL error naming the cart id is recognised by its message', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/old');
  answers.Tether_cartNoteUpdate = () => ({ errors: [{ message: 'The specified cart does not exist.' }] });
  answers.Tether_cartCreate = (variables) => payload('cartCreate', { ...oneLine(), note: variables.input.note });
  const cart = await Cart.setNote('hello');
  assert.equal(cart.note, 'hello');
});

test('expired cart: an error about a line is not mistaken for a missing cart', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  answers.Tether_cartLinesAdd = () =>
    payload('cartLinesAdd', null, [
      { field: ['lines', '0', 'merchandiseId'], message: 'The merchandise does not exist.' },
    ]);
  await assert.rejects(Cart.add(VARIANT), /merchandise does not exist/);
  assert.ok(!calls.some((c) => c.op === 'Tether_cartCreate'));
  assert.equal(Cart.id(), 'gid://shopify/Cart/abc');
});

test('isCartGone: the network, the token and other errors keep the saved cart', () => {
  assert.equal(isCartGone(new TetherError('Network error', { code: 'NETWORK' })), false);
  assert.equal(isCartGone(new TetherError('HTTP 401', { status: 401 })), false);
  assert.equal(isCartGone(new Error('does not exist')), false);
  assert.equal(isCartGone(new TetherError('x', { userErrors: [{ field: ['cartId'], message: 'x' }] })), true);
});

test('checkout: a failing account step is reported and Shopify checkout is used instead', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  Cart._commit(oneLine(), 'test');
  answers.TetherCheckout = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
  Cart.beforeCheckout = async () => {
    throw new Error('account server down');
  };
  const urls = [];
  document.addEventListener('tether:checkout', (e) => urls.push(e.detail.url), { once: true });
  const url = await Cart.checkout('_self');
  assert.equal(url, 'https://shop.test/checkouts/1');
  assert.deepEqual(urls, [url]);
  assert.deepEqual(
    reported.map((r) => r.context),
    ['account checkout'],
  );
});

test("checkout: the account's URL wins, and the cart's unneeded request failing is not a failure", async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  Cart._commit(oneLine(), 'test');
  answers.TetherCheckout = () => ({ errors: [{ message: 'Internal error' }] });
  Cart.setCustomer({ accessToken: 'tok', beforeCheckout: async () => 'https://shop.test/checkouts/c/2' });
  const url = await Cart.checkout('_self');
  assert.equal(url, 'https://shop.test/checkouts/c/2?logged_in=true');
  assert.equal(reported.length, 0);
});

test('checkout: without any checkout URL the failure is reported and nothing opens', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  Cart._commit(oneLine(), 'test');
  answers.TetherCheckout = () => ({ errors: [{ message: 'Internal error' }] });
  assert.equal(await Cart.checkout('_self'), null);
  assert.deepEqual(
    reported.map((r) => r.context),
    ['checkout failed'],
  );
});

test('applyDiscount: a refused code is removed again; a failed removal is reported, the rejection says why', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  let removals = 0;
  answers.Tether_cartDiscountCodesUpdate = (variables) => {
    if (!variables.discountCodes.length) {
      removals += 1;
      return { errors: [{ message: 'Internal error' }] };
    }
    const discountCodes = variables.discountCodes.map((code) => ({ code, applicable: false }));
    return payload('cartDiscountCodesUpdate', { ...oneLine(), discountCodes });
  };
  await assert.rejects(Cart.applyDiscount('NOPE'), (error) => error.code === 'INVALID_DISCOUNT');
  assert.equal(removals, 1);
  assert.deepEqual(
    reported.map((r) => r.context),
    ['removing a discount code Shopify refused'],
  );
});

test('customer link: setCustomer and the assignable properties are the same state', async () => {
  const beforeCheckout = async () => null;
  Cart.setCustomer({ accessToken: 'tok-1', beforeCheckout });
  assert.equal(Cart.customerAccessToken, 'tok-1');
  assert.equal(Cart.beforeCheckout, beforeCheckout);
  Cart.customerAccessToken = null;
  Cart.beforeCheckout = undefined;
  assert.equal(Cart.customerAccessToken, null);
  assert.equal(Cart.beforeCheckout, null);

  Cart.customerAccessToken = 'tok-2';
  answers.Tether_cartCreate = (variables) => payload('cartCreate', cartFrom(variables.input.lines));
  await Cart.add(VARIANT);
  assert.equal(calls[0].variables.input.buyerIdentity.customerAccessToken, 'tok-2', 'new carts belong to the customer');
});

test('trapFocus: Tab wraps inside the open drawer and goes in from outside', () => {
  // jsdom has no layout, so no element counts as visible without this.
  const layout = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return document.body;
    },
  });
  document.body.innerHTML = `<button id="out">x</button>
    <div tether-cart-drawer><button id="first">a</button><button id="last">b</button></div>`;
  Cart.open();
  const tab = (shiftKey = false) => {
    const event = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
    trapFocus(event);
    return event.defaultPrevented;
  };
  document.getElementById('last').focus();
  assert.equal(tab(), true);
  assert.equal(document.activeElement.id, 'first');
  assert.equal(tab(), false, 'Tab between the two stays with the browser');
  assert.equal(tab(true), true);
  assert.equal(document.activeElement.id, 'last');
  document.getElementById('out').focus();
  assert.equal(tab(), true);
  assert.equal(document.activeElement.id, 'first');
  Cart.close();
  document.getElementById('out').focus();
  assert.equal(tab(), false, 'a closed cart traps nothing');
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', layout);
});

test('money: amounts compare as decimals, so a line is on sale only when it is', () => {
  assert.equal(isGreaterAmount('30.0', '27'), true);
  assert.equal(isGreaterAmount('27.50', '27.5'), false);
  assert.equal(isGreaterAmount('0.30', '0.1'), true);
  assert.equal(isGreaterAmount('100000000000000000.02', '100000000000000000.01'), true, 'past float precision');
  assert.equal(isGreaterAmount(null, '1'), false);
  assert.equal(isGreaterAmount('abc', '1'), false);
});
