// The cart drawer: its open state, ARIA, focus and focus trap, manual drawers; and how cart amounts compare.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { cancelTimersAfterTests, cartFrom, detailOf, find, jsonResponse, product } from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

cancelTimersAfterTests();

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
const { bindCartControls } = await import('../src/controls/cart-controls.ts');
const { isGreaterAmount } = await import('../src/amounts.ts');

const CONFIG = { domain: 'shop.test', token: 't', autoMount: false };
configure(CONFIG);
bindCartControls();

/** @type {boolean[]} */
const toggles = [];
document.addEventListener('tether:cart-toggled', (event) => toggles.push(detailOf(event)['open'] === true));

/**
 * The open, ARIA and inert state of the drawer `selector`.
 *
 * @param {string} selector
 */
const stateOf = (selector) => {
  const drawer = find(selector);
  return {
    open: drawer.classList.contains('is-open'),
    hidden: drawer.getAttribute('aria-hidden'),
    modal: drawer.getAttribute('aria-modal'),
    inert: drawer.inert,
  };
};
const CLOSED = { open: false, hidden: 'true', modal: 'false', inert: true };
const OPEN = { open: true, hidden: 'false', modal: 'true', inert: false };
/** Lets the drawers' MutationObserver see a class change, which it gets in a microtask. */
const classChangeSeen = () => new Promise((resolve) => setTimeout(resolve, 0));
const pressEscape = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

// jsdom has no layout, so no element counts as visible without a stand-in for offsetParent.
const layout = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetParent');
assert.ok(layout);

beforeEach(() => {
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return document.body;
    },
  });
});

afterEach(async () => {
  Cart.close();
  await classChangeSeen();
  configure(CONFIG);
  toggles.length = 0;
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', layout);
});

test('trapFocus: Tab wraps inside the open drawer and goes in from outside', () => {
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
  assert.equal(document.activeElement.id, 'last');
  find('#out').focus();
  assert.equal(tab(), true);
  assert.equal(document.activeElement.id, 'first');
  Cart.close();
  find('#out').focus();
  assert.equal(tab(), false, 'a closed cart traps nothing');
});

test('a drawer: closed it is aria-hidden and inert; open, focus moves in, and goes back on close', async () => {
  document.body.innerHTML = `<button id="opener" tether-cart-open>Cart</button>
    <div id="drawer" tether-cart-drawer tether-cart-label="Basket"><button id="inside">x</button></div>`;
  Cart.render();
  const drawer = find('#drawer');
  assert.equal(drawer.getAttribute('role'), 'dialog');
  assert.equal(drawer.getAttribute('aria-label'), 'Basket');
  assert.deepEqual(stateOf('#drawer'), CLOSED);
  assert.equal(find('#opener').getAttribute('aria-expanded'), 'false');

  find('#opener').focus();
  find('#opener').click();
  assert.deepEqual(stateOf('#drawer'), OPEN);
  assert.equal(find('#opener').getAttribute('aria-expanded'), 'true');
  await waitFor(() => document.activeElement?.id === 'inside', 'focus to move into the drawer');
  Cart.render();
  assert.deepEqual(stateOf('#drawer'), OPEN, 'a render keeps it open');

  pressEscape();
  assert.deepEqual(stateOf('#drawer'), CLOSED);
  assert.equal(find('#opener').getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement?.id, 'opener', 'focus goes back');
  await classChangeSeen();
  assert.deepEqual(toggles, [true, false], 'each change is announced once');
});

test('several drawers open and close together; a manual one is left to the site', () => {
  document.body.innerHTML = `<div id="a" tether-cart-drawer></div><div id="b" tether-cart-drawer></div>
    <div id="m" tether-cart-drawer="manual"></div>`;
  Cart.render();
  /** @type {string[][]} */
  const opened = [];
  configure({ ...CONFIG, onCartOpen: (drawers) => opened.push(drawers.map((drawer) => drawer.id)) });
  Cart.open();
  assert.deepEqual([stateOf('#a'), stateOf('#b'), stateOf('#m')], [OPEN, OPEN, CLOSED]);
  assert.deepEqual(opened, [['a', 'b']]);
  Cart.close();
  assert.deepEqual([stateOf('#a'), stateOf('#b'), stateOf('#m')], [CLOSED, CLOSED, CLOSED]);
});

test('a manual drawer: the site opens it with the open class, Tether follows, and closes it', async () => {
  document.body.innerHTML = `<button id="site-button">Cart</button>
    <div id="m" tether-cart-drawer="manual"><a id="inside" href="/cart">Cart page</a></div>`;
  Cart.render();
  assert.deepEqual(stateOf('#m'), CLOSED);

  Cart.open();
  await classChangeSeen();
  assert.equal(Cart.isOpen(), false, 'Tether.cart.open() leaves a manual drawer to the site');
  assert.deepEqual(stateOf('#m'), CLOSED);
  assert.deepEqual(toggles, [], 'nothing opened, so nothing is announced');

  find('#site-button').focus();
  find('#m').classList.add('is-open');
  await classChangeSeen();
  assert.equal(Cart.isOpen(), true);
  assert.deepEqual(stateOf('#m'), OPEN, 'usable: neither inert nor hidden');
  Cart.render();
  assert.deepEqual(stateOf('#m'), OPEN, 'a render keeps the open drawer usable');
  assert.deepEqual(toggles, [true]);
  await waitFor(() => document.activeElement?.id === 'inside', 'focus to move into the drawer');

  pressEscape();
  assert.deepEqual(stateOf('#m'), CLOSED, 'Escape closes it');
  assert.equal(document.activeElement?.id, 'site-button');
  await classChangeSeen();
  assert.deepEqual(toggles, [true, false]);

  find('#m').classList.add('is-open');
  await classChangeSeen();
  find('#m').classList.remove('is-open');
  await classChangeSeen();
  assert.deepEqual(stateOf('#m'), CLOSED, 'the site closing it is followed too');
  assert.deepEqual(toggles, [true, false, true, false]);

  find('#m').classList.add('is-open');
  await classChangeSeen();
  Cart.close();
  assert.deepEqual(stateOf('#m'), CLOSED, 'Tether.cart.close() closes it');
});

test('cartFocus: false leaves focus alone, and a closed drawer is still inert, out of the Tab order', async () => {
  configure({ ...CONFIG, cartFocus: false });
  document.body.innerHTML = `<button id="opener">Cart</button><div id="drawer" tether-cart-drawer><button>x</button></div>`;
  Cart.render();
  assert.deepEqual(stateOf('#drawer'), CLOSED, 'nothing aria-hidden can take focus');
  find('#opener').focus();
  Cart.open();
  assert.deepEqual(stateOf('#drawer'), OPEN);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(document.activeElement?.id, 'opener');
  Cart.close();
  assert.deepEqual(stateOf('#drawer'), CLOSED);
});

test('a throwing onCartOpen or onCartClose is reported: the add still succeeds, and cart-toggled still fires', async () => {
  document.body.innerHTML = '';
  const merchandiseId = product.variants.nodes[0]?.id ?? '';
  const cart = cartFrom([{ merchandiseId, quantity: 1 }]);
  const { fetch } = globalThis;
  globalThis.fetch = async () => jsonResponse({ data: { cartCreate: { cart, userErrors: [], warnings: [] } } });
  /** @type {string[]} */
  const reported = [];
  const bug = () => {
    throw new Error('site hook bug');
  };
  configure({
    ...CONFIG,
    onCartOpen: bug,
    onCartClose: bug,
    onError: (error, context) => reported.push(`${context}: ${String(error)}`),
  });
  toggles.length = 0;
  try {
    assert.equal((await Cart.add(merchandiseId)).totalQuantity, 1);
    assert.equal(Cart.status.kind, 'ready');
    assert.equal(Cart.isOpen(), true);
    Cart.close();
    assert.deepEqual(toggles, [true, false]);
    assert.deepEqual(reported, ['onCartOpen: Error: site hook bug', 'onCartClose: Error: site hook bug']);
  } finally {
    globalThis.fetch = fetch;
    configure(CONFIG);
    localStorage.clear();
  }
});

test('money: amounts compare as decimals, so a line is on sale only when it is', () => {
  assert.equal(isGreaterAmount('30.0', '27'), true);
  assert.equal(isGreaterAmount('27.50', '27.5'), false);
  assert.equal(isGreaterAmount('0.30', '0.1'), true);
  assert.equal(isGreaterAmount('100000000000000000.02', '100000000000000000.01'), true, 'past float precision');
  assert.equal(isGreaterAmount(null, '1'), false);
  assert.equal(isGreaterAmount('abc', '1'), false);
});
