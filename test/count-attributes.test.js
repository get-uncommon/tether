// Count attributes (tether-limit, tether-search-limit, tether-search-min) are parsed once, kept within what Shopify
// takes, and warn once per element.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  cancelTimersAfterTests,
  captureTetherWarnings,
  find,
  graphqlRequest,
  jsonResponse,
  operationName,
  product,
  pageGlobals,
} from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

cancelTimersAfterTests();
const warnings = captureTetherWarnings();

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
Object.assign(globalThis, pageGlobals(dom.window));

const products = ['a', 'b', 'c', 'd', 'e', 'f'].map((handle, index) => ({
  ...structuredClone(product),
  id: `gid://shopify/Product/${String(index + 10)}`,
  handle,
}));

/** @type {{ op: string, variables: Record<string, unknown> }[]} */
const calls = [];
/**
 * @param {RequestInfo | URL} _url
 * @param {RequestInit} [init]
 */
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  const op = operationName(query);
  calls.push({ op, variables });
  const pageInfo = { hasNextPage: false, endCursor: null };
  const data = {
    TetherRecs: () => ({ productRecommendations: products }),
    TetherSearch: () => ({ products: { nodes: products.slice(0, 2), pageInfo } }),
    TetherPredictive: () => ({ predictiveSearch: { products: [], collections: [], queries: [] } }),
  }[op];
  if (!data) throw new Error(`unexpected ${op}`);
  return jsonResponse({ data: data() });
};

/** @type {typeof import('../src/dom.ts').integerAttribute} */
let integerAttribute;
/** @type {typeof import('../src/lists.ts').loadList} */
let loadList;
/** @type {typeof import('../src/search.ts').mountSearch} */
let mountSearch;

before(async () => {
  const { configure } = await import('../src/config.ts');
  configure({ domain: 'shop.test', token: 't', searchDelay: 0, retries: 0 });
  ({ integerAttribute } = await import('../src/dom.ts'));
  ({ loadList } = await import('../src/lists.ts'));
  ({ mountSearch } = await import('../src/search.ts'));
});

beforeEach(() => {
  calls.length = 0;
  warnings.length = 0;
});

/** @param {string | null} value */
function withLimit(value) {
  const el = document.createElement('div');
  if (value !== null) el.setAttribute('tether-limit', value);
  return el;
}

const RANGE = { min: 1, max: 250, fallback: 24 };

/** @returns The message of the last Tether warning. */
const lastWarning = () => warnings[warnings.length - 1]?.[1];

test('a count attribute is a whole number from its minimum; a larger one is its maximum', () => {
  assert.equal(integerAttribute(withLimit('12'), 'limit', RANGE), 12);
  assert.equal(integerAttribute(withLimit(' 7 '), 'limit', RANGE), 7);
  assert.equal(integerAttribute(withLimit(null), 'limit', RANGE), 24);
  assert.equal(integerAttribute(withLimit(''), 'limit', RANGE), 24);
  assert.deepEqual(warnings, [], 'a missing or empty attribute is no mistake');
  assert.equal(integerAttribute(withLimit('300'), 'limit', RANGE), 250);
  assert.deepEqual(lastWarning(), 'tether-limit 300 is more than its maximum: using 250');
  for (const value of ['-4', '0', '2.5', 'abc', '0x10', '1e2']) {
    assert.equal(integerAttribute(withLimit(value), 'limit', RANGE), 24, value);
    assert.equal(lastWarning(), `tether-limit ${JSON.stringify(value)} is not a whole number from 1: using 24`, value);
  }
  assert.equal(integerAttribute(withLimit('100000'), 'limit', { min: 1, fallback: 2 }), 100000, 'no maximum');
});

test('an element warns once for each invalid attribute, however often it is read', () => {
  const el = withLimit('-4');
  integerAttribute(el, 'limit', RANGE);
  integerAttribute(el, 'limit', RANGE);
  assert.equal(warnings.length, 1);
});

test("a list's tether-limit above 250 asks for 250, and a negative one on recommendations shows them all", async () => {
  document.body.innerHTML = `
    <div id="search" tether-products="coffee" tether-limit="300"><span tether-collection-bind="count"></span></div>
    <div id="recs" tether-recommendations="coffee-box" tether-limit="-4"><span tether-collection-bind="count"></span></div>
    <div id="three" tether-recommendations="coffee-box" tether-limit="3"><span tether-collection-bind="count"></span></div>`;
  await loadList(find('#search'));
  assert.equal(calls.find((call) => call.op === 'TetherSearch')?.variables['first'], 250);
  await loadList(find('#recs'));
  assert.equal(find('#recs [tether-collection-bind]').textContent, String(products.length), 'no slice(0, -4)');
  await loadList(find('#three'));
  assert.equal(find('#three [tether-collection-bind]').textContent, '3');
});

test("tether-search-limit above Shopify's 10 asks for 10", async () => {
  document.body.innerHTML = `
    <form tether-search tether-search-limit="12">
      <input tether-search-input name="q">
      <div tether-search-results><div tether-search-products><a></a></div></div>
    </form>`;
  mountSearch(document);
  const root = find('[tether-search]');
  const input = /** @type {HTMLInputElement} */ (find('input', root));
  input.value = 'coffee';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => root.getAttribute('tether-search-state') === 'empty', 'the search');
  assert.equal(calls[0]?.variables['limit'], 10);
  assert.equal(warnings[0]?.[1], 'tether-search-limit 12 is more than its maximum: using 10');
});
