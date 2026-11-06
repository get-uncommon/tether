// window.Tether's own members: the lazy account API and the reporting of the optional parts' failures.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
});
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { cart: null } }) });

const errors = [];
let Tether;

before(async () => {
  ({ default: Tether } = await import('../src/index.js'));
  await Tether.init({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    onError: (error, context) => errors.push({ error, context }),
  });
});

test('Tether.account is a plain object of the account part’s functions, not a thenable', async () => {
  assert.equal(Tether.account.then, undefined);
  assert.equal(await Tether.account, Tether.account);
  assert.deepEqual(Object.keys(Tether.account).sort(), [
    'addresses',
    'customer',
    'deleteAddress',
    'getToken',
    'handleCallback',
    'isLoggedIn',
    'login',
    'logout',
    'mountAccount',
    'order',
    'orders',
    'query',
    'render',
    'requestReturn',
    'saveAddress',
    'subscriptionAction',
    'subscriptions',
    'updateProfile',
  ]);
  const part = await import('../src/account.js');
  for (const name of Object.keys(Tether.account)) assert.equal(typeof part[name], 'function', name);
  assert.equal(await Tether.account.isLoggedIn(), part.isLoggedIn());
});

test('a failure in the extras part is reported, not swallowed', async () => {
  document.body.innerHTML = '<div id="p" tether-variant-url></div>';
  errors.length = 0;
  // A detail without a variant makes the part's writeVariantUrl throw.
  document
    .getElementById('p')
    .dispatchEvent(new window.CustomEvent('tether:variant-changed', { detail: {}, bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].context, 'extras');
});
