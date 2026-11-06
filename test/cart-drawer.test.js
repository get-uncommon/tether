// The cart drawer's focus trap, and how cart amounts compare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { find } from './fixtures.js';

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
const { isGreaterAmount } = await import('../src/amounts.ts');

configure({ domain: 'shop.test', token: 't', autoMount: false });

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
  assert.equal(document.activeElement.id, 'last');
  find('#out').focus();
  assert.equal(tab(), true);
  assert.equal(document.activeElement.id, 'first');
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
