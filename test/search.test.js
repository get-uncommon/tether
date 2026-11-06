// Search as you type: input → predictive query → rendered results, keyboard, errors.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { captureTetherWarnings } from './fixtures.js';

// The failures these tests cause on purpose are checked through onError and states, not the console.
captureTetherWarnings();

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://site.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
});

const calls = [];
let failNext = false;
globalThis.fetch = async (url, init) => {
  const { query, variables } = JSON.parse(init.body);
  calls.push({ op: query.match(/query\s+(\w+)/)[1], variables });
  if (failNext) {
    failNext = false;
    return { ok: false, status: 500, json: async () => ({}) };
  }
  const money = { amount: '30.0', currencyCode: 'EUR' };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        predictiveSearch: {
          products: [
            {
              id: 'gid://shopify/Product/1',
              handle: 'coffee-box',
              title: 'Coffee box',
              availableForSale: false,
              featuredImage: null,
              priceRange: { minVariantPrice: money },
            },
          ],
          collections: [{ handle: 'coffee', title: 'Coffee', image: null }],
          queries: [{ text: variables.q }, { text: `${variables.q} beans` }],
        },
      },
    }),
  };
};

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
let mountSearch;

before(async () => {
  const { configure } = await import('../src/config.js');
  configure({
    domain: 'shop.test',
    token: 't',
    searchDelay: 0,
    retries: 0,
    onError: (error, context) => errors.push(context),
  });
  ({ mountSearch } = await import('../src/search.js'));
});

const markup = `
  <form tether-search action="/search" tether-search-limit="4">
    <input tether-search-input name="q">
    <div tether-search-results>
      <div tether-search-products><a><span tether-search-bind="title"></span><span tether-search-bind="price"></span></a></div>
      <div tether-search-queries><a><span tether-search-bind="text"></span></a></div>
      <div tether-search-collections><a><span tether-search-bind="title"></span></a></div>
      <p tether-show="search-empty">No results</p>
    </div>
  </form>`;

const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};

test('typing sends one predictive query and renders products, queries and collections', async () => {
  document.body.innerHTML = markup;
  mountSearch(document);
  mountSearch(document); // a second mount of the same root does nothing
  const root = document.querySelector('[tether-search]');
  const input = root.querySelector('input');
  const results = root.querySelector('[tether-search-results]');
  assert.equal(input.getAttribute('role'), 'combobox');
  assert.equal(input.getAttribute('aria-controls'), results.id);
  assert.equal(results.hidden, true);

  let searched = null;
  root.addEventListener('tether:search', (event) => {
    searched = event.detail;
  });
  type(input, 'c');
  await tick();
  assert.equal(calls.length, 0, 'below the minimum length');
  assert.equal(root.getAttribute('tether-search-state'), 'idle');

  type(input, 'cof');
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].variables, { q: 'cof', limit: 4 });
  assert.equal(root.getAttribute('tether-search-state'), 'ready');
  assert.ok(root.classList.contains('is-open'));
  assert.equal(results.hidden, false);
  const product = root.querySelector('[tether-search-products] a');
  assert.equal(product.querySelector('[tether-search-bind="title"]').textContent, 'Coffee box');
  assert.match(product.querySelector('[tether-search-bind="price"]').textContent, /30/);
  assert.equal(product.getAttribute('href'), '/product/coffee-box');
  assert.ok(product.classList.contains('is-sold-out'));
  const queries = [...root.querySelectorAll('[tether-search-queries] a')];
  assert.deepEqual(
    queries.map((link) => link.getAttribute('href')),
    ['/search?q=cof%20beans'],
    'the typed term itself is not suggested',
  );
  assert.equal(root.querySelector('[tether-search-collections] a').getAttribute('href'), '/collection/coffee');
  assert.equal(root.querySelector('[tether-show="search-empty"]').style.display, 'none');
  assert.equal(searched.term, 'cof');

  type(input, 'cof');
  await tick();
  assert.equal(calls.length, 1, 'the same term is not searched again');
});

test('arrow keys move through the options, Escape closes', () => {
  const root = document.querySelector('[tether-search]');
  const input = root.querySelector('input');
  const key = (name) => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true }));
  const options = [...root.querySelectorAll('[role="option"]')];
  assert.equal(options.length, 2);
  key('ArrowDown');
  assert.equal(input.getAttribute('aria-activedescendant'), options[0].id);
  key('ArrowUp');
  assert.equal(input.getAttribute('aria-activedescendant'), options[1].id, 'wraps around');
  key('Escape');
  assert.ok(!root.classList.contains('is-open'));
  assert.equal(input.hasAttribute('aria-activedescendant'), false);
});

test('a failed search sets the error state and reaches onError', async () => {
  const root = document.querySelector('[tether-search]');
  failNext = true;
  type(root.querySelector('input'), 'tea');
  await tick(60);
  assert.equal(root.getAttribute('tether-search-state'), 'error');
  assert.deepEqual(errors, ['search']);
});
