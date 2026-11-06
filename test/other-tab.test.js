// Another tab of the same site changes the market: this tab follows it through the extras part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { waitFor } from '../server/test/mocks.js';

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
await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL' });

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
