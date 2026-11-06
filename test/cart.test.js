// The cart on its own: status, queue, expired carts, checkout and the drawer's focus trap.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  captureTetherWarnings,
  cartFrom,
  detailOf,
  find,
  graphqlRequest,
  jsonResponse,
  operationName,
  product,
} from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

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
const { Cart, trapFocus } = await import('../src/cart.ts');
const { serial } = await import('../src/cart/store.ts');
const { isCartGone } = await import('../src/cart/mutations.ts');
const { TetherError } = await import('../src/client.ts');
const { isGreaterAmount } = await import('../src/amounts.ts');

const KEY = 'tether:cart:shop.test';
const VARIANT = product.variants.nodes[0].id;
const reported = [];
const calls = [];
/** op name -> (variables) => response body, or a Promise of one */
let answers = {};

globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  const op = operationName(query);
  calls.push({ op, variables });
  const answer = answers[op];
  if (!answer) throw new Error(`unexpected op ${op}`);
  const body = await answer(variables);
  return jsonResponse(body);
};

const payload = (name, cart, userErrors = []) => ({ data: { [name]: { cart, userErrors, warnings: [] } } });
const oneLine = (quantity = 1) => cartFrom([{ merchandiseId: VARIANT, quantity }]);
/** Loads `cart` as the saved cart, the way a page with a cart starts. */
const loadSaved = async (cart) => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  answers.TetherCart = () => ({ data: { cart } });
  await Cart.init();
};
const deferred = () => {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
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
  answers.TetherCart = () => ({ data: { cart: oneLine(2) } });
  await Cart.init();
  assert.equal(Cart.status.kind, 'ready');
  assert.equal(Cart.count, 2);
  assert.equal(Cart.lastError, null);

  answers.TetherCart = () => ({ errors: [{ message: 'Internal error' }] });
  await Cart.init();
  assert.equal(Cart.status.kind, 'error');
  assert.match(String(Cart.lastError), /Internal error/);
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
  document.addEventListener('tether:cart-error', (e) => errors.push(detailOf(e).error));
  answers.Tether_cartLinesAdd = () => payload('cartLinesAdd', null, [{ field: ['lines'], message: 'Sold out' }]);
  await assert.rejects(Cart.add(VARIANT), /Sold out/);
  assert.equal(Cart.status.kind, 'error');
  assert.equal(Cart.count, 1, 'the cart as Shopify last sent it');
  assert.equal(errors.length, 1);
  assert.notEqual(find('#err').style.display, 'none');

  answers.Tether_cartLinesAdd = () => payload('cartLinesAdd', oneLine(2));
  await Cart.add(VARIANT);
  assert.equal(Cart.status.kind, 'ready');
  assert.equal(Cart.lastError, null);
  assert.equal(find('#err').style.display, 'none');
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
  // Every task already queued has run by the next macrotask: b would have started by then.
  await new Promise(setImmediate);
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
  await waitFor(() => calls.length > 0, 'the first change to be sent');
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

test('forgetSaved: drops the saved cart and shows an empty one, as a load of no cart does', async () => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  answers.TetherCart = () => ({ data: { cart: oneLine(2) } });
  await Cart.init();
  assert.equal(Cart.count, 2);
  const updates = [];
  const listener = (event) => updates.push(event.detail);
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
  assert.ok(cart);
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
  await loadSaved(oneLine());
  answers.TetherCheckout = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
  Cart.setCheckoutResolver(async () => {
    throw new Error('account server down');
  });
  const urls = [];
  document.addEventListener('tether:checkout', (e) => urls.push(detailOf(e).url), { once: true });
  const url = await Cart.checkout('_self');
  assert.equal(url, 'https://shop.test/checkouts/1');
  assert.deepEqual(urls, [url]);
  assert.deepEqual(
    reported.map((r) => r.context),
    ['account checkout'],
  );
});

test("checkout: the account's URL wins, and the cart's unneeded request failing is not a failure", async () => {
  await loadSaved(oneLine());
  answers.TetherCheckout = () => ({ errors: [{ message: 'Internal error' }] });
  Cart.setCheckoutResolver(async () => 'https://shop.test/checkouts/c/2?key=k');
  const url = await Cart.checkout('_self');
  assert.equal(url, 'https://shop.test/checkouts/c/2?key=k&logged_in=true');
  assert.equal(reported.length, 0);
});

test("checkout: null from the account uses the cart's URL, without the login parameter", async () => {
  await loadSaved(oneLine());
  answers.TetherCheckout = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
  Cart.setCheckoutResolver(async () => null);
  assert.equal(await Cart.checkout('_self'), 'https://shop.test/checkouts/1');
  Cart.setCheckoutResolver(null);
  assert.equal(await Cart.checkout('_self'), 'https://shop.test/checkouts/1', 'cleared: the cart decides');
  assert.equal(reported.length, 0);
});

test('checkout: without any checkout URL the failure is reported and nothing opens', async () => {
  await loadSaved(oneLine());
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
  await assert.rejects(
    Cart.applyDiscount('NOPE'),
    (error) => error instanceof TetherError && error.code === 'INVALID_DISCOUNT',
  );
  assert.equal(removals, 1);
  assert.deepEqual(
    reported.map((r) => r.context),
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

test('trapFocus: Tab wraps inside the open drawer and goes in from outside', () => {
  // jsdom has no layout, so no element counts as visible without this.
  const layout = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetParent');
  assert.ok(layout);
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
  find('#last').focus();
  assert.equal(tab(), true);
  assert.equal(document.activeElement?.id, 'first');
  assert.equal(tab(), false, 'Tab between the two stays with the browser');
  assert.equal(tab(true), true);
  assert.equal(document.activeElement?.id, 'last');
  find('#out').focus();
  assert.equal(tab(), true);
  assert.equal(document.activeElement?.id, 'first');
  Cart.close();
  find('#out').focus();
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
