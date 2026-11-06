// window.Tether's own members: the lazy account API and the reporting of the optional parts' failures.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { captureTetherWarnings, find, jsonResponse } from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

// The failures these tests cause on purpose are checked through onError and states, not the console.
captureTetherWarnings();

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
});
globalThis.fetch = async () => jsonResponse({ data: { cart: null } });

/** @type {{ error: unknown, context: string }[]} */
const errors = [];
/** @type {typeof import('../src/index.ts').default} */
let Tether;

before(async () => {
  ({ default: Tether } = await import('../src/index.ts'));
  await Tether.init({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    onError: (error, context) => errors.push({ error, context }),
  });
});

test('Tether.account is a plain object of the account part’s functions, not a thenable', async () => {
  assert.equal(Reflect.get(Tether.account, 'then'), undefined);
  assert.equal(await Promise.resolve(Tether.account), Tether.account);
  assert.deepEqual(Object.keys(Tether.account).sort(), [
    'addresses',
    'customer',
    'deleteAddress',
    'isLoggedIn',
    'login',
    'logout',
    'mountAccount',
    'order',
    'orders',
    'render',
    'requestReturn',
    'saveAddress',
    'subscriptionAction',
    'subscriptions',
    'updateProfile',
  ]);
  const part = await import('../src/account.ts');
  for (const name of Object.keys(Tether.account)) assert.equal(typeof Reflect.get(part, name), 'function', name);
  assert.equal(await Tether.account.isLoggedIn(), part.isLoggedIn());
});

test('a failure in the extras part is reported, not swallowed', async () => {
  document.body.innerHTML = '<div id="p" tether-variant-url></div>';
  errors.length = 0;
  const { emit } = await import('../src/dom.ts');
  // A detail without a variant makes the part's writeVariantUrl throw.
  // @ts-expect-error -- the broken detail this test sends on purpose
  emit('variant-changed', {}, find('#p'));
  await waitFor(() => errors.length > 0, 'the extras part to report its failure');
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.context, 'extras');
});

test('Tether.on hears only the events Tether dispatched: a forged tether:cart-updated never reaches the listener', async () => {
  const { emit } = await import('../src/dom.ts');
  /** @type {unknown[]} */
  const heard = [];
  const off = Tether.on('cart-updated', ({ cart, reason }) => heard.push({ cart, reason }));
  document.dispatchEvent(new window.Event('tether:cart-updated'));
  document.dispatchEvent(new window.CustomEvent('tether:cart-updated', { detail: { cart: 'forged', reason: 'add' } }));
  emit('cart-updated', { cart: null, reason: 'load' });
  off();
  emit('cart-updated', { cart: null, reason: 'add' });
  assert.deepEqual(heard, [{ cart: null, reason: 'load' }]);
});

test('a forged tether:variant-changed loads nothing and writes no variant link', async () => {
  document.body.innerHTML = '<div id="p" tether-variant-url></div>';
  errors.length = 0;
  const before = window.location.href;
  find('#p').dispatchEvent(new window.CustomEvent('tether:variant-changed', { detail: {}, bubbles: true }));
  // Nothing is meant to happen, so there is no condition to wait for: a handler that took the forged detail would have
  // loaded and reported by now.
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(errors, []);
  assert.equal(window.location.href, before);
});
