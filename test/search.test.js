// Search as you type: input → predictive query → rendered results, keyboard, errors.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { captureTetherWarnings, detailOf, find, graphqlRequest, jsonResponse, operationName } from './fixtures.js';

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
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  calls.push({ op: operationName(query), variables });
  if (failNext) {
    failNext = false;
    return jsonResponse({}, 500);
  }
  const money = { amount: '30.0', currencyCode: 'EUR' };
  return jsonResponse({
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
  });
};

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
let mountSearch;

before(async () => {
  const { configure } = await import('../src/config.ts');
  configure({
    domain: 'shop.test',
    token: 't',
    searchDelay: 0,
    retries: 0,
    onError: (_error, context) => errors.push(context),
  });
  ({ mountSearch } = await import('../src/search.ts'));
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
  const root = find('[tether-search]');
  const input = root.querySelector('input');
  assert.ok(input);
  const results = find('[tether-search-results]', root);
  assert.equal(input.getAttribute('role'), 'combobox');
  assert.equal(input.getAttribute('aria-controls'), results.id);
  assert.equal(results.hidden, true);

  const searches = [];
  root.addEventListener('tether:search', (event) => searches.push(detailOf(event)));
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
  const product = find('[tether-search-products] a', root);
  assert.equal(find('[tether-search-bind="title"]', product).textContent, 'Coffee box');
  assert.match(find('[tether-search-bind="price"]', product).textContent, /30/);
  assert.equal(product.getAttribute('href'), '/product/coffee-box');
  assert.ok(product.classList.contains('is-sold-out'));
  const queries = [...root.querySelectorAll('[tether-search-queries] a')];
  assert.deepEqual(
    queries.map((link) => link.getAttribute('href')),
    ['/search?q=cof%20beans'],
    'the typed term itself is not suggested',
  );
  assert.equal(find('[tether-search-collections] a', root).getAttribute('href'), '/collection/coffee');
  assert.equal(find('[tether-show="search-empty"]', root).style.display, 'none');
  assert.equal(searches.at(-1).term, 'cof');

  type(input, 'cof');
  await tick();
  assert.equal(calls.length, 1, 'the same term is not searched again');
});

test('arrow keys move through the options, Escape closes', () => {
  const root = find('[tether-search]');
  const input = root.querySelector('input');
  assert.ok(input);
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
  const root = find('[tether-search]');
  failNext = true;
  type(root.querySelector('input'), 'tea');
  await tick(60);
  assert.equal(root.getAttribute('tether-search-state'), 'error');
  assert.deepEqual(errors, ['search']);
});
