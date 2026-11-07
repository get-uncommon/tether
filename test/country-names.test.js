// The country names of tether-country-select and tether-country-bind follow the market's language.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { cancelTimersAfterTests, find, graphqlRequest, jsonResponse, operationName, pageGlobals } from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

cancelTimersAfterTests();

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://names.test/' });
Object.assign(globalThis, pageGlobals(dom.window));
const realFetch = globalThis.fetch;

/** @type {Record<string, string>} */
const ENGLISH = { DE: 'Germany', NL: 'Netherlands', US: 'United States' };
/** @type {Record<string, string>} */
const FRENCH = { DE: 'Allemagne', NL: 'Pays-Bas', US: 'États-Unis' };

/**
 * @param {RequestInfo | URL} _url
 * @param {RequestInit} [init]
 */
globalThis.fetch = async (_url, init) => {
  const { query } = graphqlRequest(init);
  if (operationName(query) !== 'TetherLocalization') return jsonResponse({ data: { cart: null } });
  const names = query.includes('language: FR') ? FRENCH : ENGLISH;
  /** @param {string} isoCode */
  const country = (isoCode) => ({
    isoCode,
    name: names[isoCode],
    currency: { isoCode: isoCode === 'US' ? 'USD' : 'EUR', symbol: '€' },
    availableLanguages: [],
  });
  const localization = { country: country('NL'), language: null, availableCountries: ['DE', 'NL', 'US'].map(country) };
  return jsonResponse({ data: { localization } });
};

/** @type {typeof import('../src/index.ts').default} */
let Tether;

before(async () => {
  ({ default: Tether } = await import('../src/index.ts'));
  await Tether.init({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    country: 'NL',
    markets: { locales: { 'fr-us': { country: 'US', language: 'FR' } } },
  });
});
after(() => {
  globalThis.fetch = realFetch;
});

test('a country whose markets.locales entry has another language renames the countries in it', async () => {
  document.body.innerHTML = '<select tether-country-select></select><span id="name" tether-country-bind="name"></span>';
  Tether.mount(document);
  await waitFor(() => find('#name').textContent === 'Netherlands', 'the country names in English');
  const select = document.querySelector('select');
  assert.ok(select);
  select.value = 'US';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => find('#name').textContent === 'États-Unis', 'the country names in French');
  assert.equal(Tether.config.language, 'FR');
  assert.deepEqual(
    [...select.options].map((option) => option.textContent),
    ['Allemagne (EUR)', 'États-Unis (USD)', 'Pays-Bas (EUR)'],
  );
});
