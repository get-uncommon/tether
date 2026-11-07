// Product lists: tether-load-more pages, a reload a "load more" can't race, tether-sort checked per source, and what a
// url: list without its search shows.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  cancelTimersAfterTests,
  captureTetherWarnings,
  find,
  findAll,
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

/** @param {string[]} handles */
const productsOf = (handles) =>
  handles.map((handle, index) => ({
    ...structuredClone(product),
    id: `gid://shopify/Product/${String(index + 10)}`,
    handle,
  }));

/**
 * @param {string[]} handles
 * @param {string | null} endCursor The next page's cursor, `null` on the last page.
 */
const collectionPage = (handles, endCursor) => ({
  collection: {
    id: 'gid://shopify/Collection/1',
    handle: 'coffee',
    title: 'Coffee',
    description: '',
    descriptionHtml: '',
    image: null,
    seo: { title: null, description: null },
    products: { nodes: productsOf(handles), pageInfo: { hasNextPage: endCursor !== null, endCursor } },
  },
});

/** @typedef {{ op: string, variables: Record<string, unknown> }} Call */
/** @type {Call[]} */
const calls = [];
/** @type {(call: Call) => Response | Promise<Response>} */
let answer = () => jsonResponse({ data: collectionPage(['a'], null) });
/**
 * @param {RequestInfo | URL} _url
 * @param {RequestInit} [init]
 */
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  const call = { op: operationName(query), variables };
  calls.push(call);
  return answer(call);
};

/** @type {typeof import('../src/lists.ts').loadList} */
let loadList;

before(async () => {
  const { configure } = await import('../src/config.ts');
  configure({ domain: 'shop.test', token: 't', retries: 0 });
  ({ loadList } = await import('../src/lists.ts'));
});

beforeEach(() => {
  calls.length = 0;
  warnings.length = 0;
  document.body.innerHTML = `
    <div id="list" tether-collection="coffee">
      <div tether-list><div class="card"></div></div>
      <button tether-load-more>Load more</button>
    </div>`;
});

/** @returns The handles of the rendered cards. */
const cards = () => findAll('#list [tether-list] > *').map((card) => card.getAttribute('tether-product'));
const loadMore = () => find('[tether-load-more]');
/** @param {string} what */
const loadMoreDone = (what) => waitFor(() => !loadMore().hasAttribute('aria-busy'), what);

test('"load more" appends the next page from the cursor, and hides once there is none', async () => {
  answer = ({ variables }) =>
    jsonResponse({
      data: variables['after'] === 'page-2' ? collectionPage(['c'], null) : collectionPage(['a', 'b'], 'page-2'),
    });
  await loadList(find('#list'));
  assert.deepEqual(cards(), ['a', 'b']);
  assert.notEqual(loadMore().style.display, 'none');
  loadMore().click();
  await waitFor(() => cards().length === 3, 'the next page');
  assert.deepEqual(cards(), ['a', 'b', 'c']);
  assert.deepEqual(
    calls.map((call) => call.variables['after']),
    [null, 'page-2'],
  );
  assert.equal(loadMore().style.display, 'none', 'the last page has no next one');
});

test('a failed "load more" keeps the rendered cards', async () => {
  answer = () => jsonResponse({ data: collectionPage(['a', 'b'], 'page-2') });
  await loadList(find('#list'));
  answer = () => jsonResponse({}, 500);
  loadMore().click();
  await loadMoreDone('the failed page');
  assert.equal(calls.length, 2);
  assert.deepEqual(cards(), ['a', 'b']);
  assert.equal(find('#list').getAttribute('tether-state'), 'ready');
  assert.notEqual(loadMore().style.display, 'none', 'the visitor can try again');
});

test('"load more" during a reload does nothing: its page would follow the products being replaced', async () => {
  answer = () => jsonResponse({ data: collectionPage(['a', 'b'], 'page-2') });
  await loadList(find('#list'));
  /** @type {(response: Response) => void} */
  let finishReload = () => undefined;
  answer = () =>
    new Promise((resolve) => {
      finishReload = resolve;
    });
  const reload = loadList(find('#list'));
  await waitFor(() => calls.length === 2, 'the reload');
  loadMore().click();
  await loadMoreDone('the click');
  finishReload(jsonResponse({ data: collectionPage(['x', 'y'], 'page-2-x') }));
  await reload;
  assert.equal(calls.length, 2, 'no page 2 of the old products');
  assert.deepEqual(cards(), ['x', 'y']);
  answer = () => jsonResponse({ data: collectionPage(['z'], null) });
  loadMore().click();
  await waitFor(() => cards().length === 3, 'the next page after the reload');
  assert.equal(calls[2]?.variables['after'], 'page-2-x');
});

test('tether-sort takes the sort keys of its source; another key warns once and uses the default', async () => {
  answer = ({ op }) =>
    jsonResponse({
      data:
        op === 'TetherSearch'
          ? { products: { nodes: productsOf(['a']), pageInfo: { hasNextPage: false, endCursor: null } } }
          : collectionPage(['a'], null),
    });
  document.body.innerHTML = `
    <div id="best" tether-collection="coffee" tether-sort="BEST_SELLING"></div>
    <div id="newest" tether-collection="coffee" tether-sort="CREATED_AT"></div>
    <div id="search" tether-products="tag:coffee" tether-sort="CREATED"></div>
    <div id="vendor" tether-products="tag:coffee" tether-sort="VENDOR"></div>
    <div id="manual" tether-products="tag:coffee" tether-sort="MANUAL"></div>`;
  for (const id of ['best', 'newest', 'search', 'vendor', 'manual']) await loadList(find(`#${id}`));
  await loadList(find('#newest'));
  assert.deepEqual(
    calls.map((call) => call.variables['sortKey']),
    ['BEST_SELLING', undefined, 'CREATED_AT', 'VENDOR', undefined, undefined],
  );
  assert.deepEqual(
    warnings.map((args) => args[1]),
    [
      'tether-sort "CREATED_AT" is not a sort key of this list: using the default',
      'tether-sort "MANUAL" is not a sort key of this list: using the default',
    ],
  );
  assert.deepEqual(
    ['newest', 'manual'].map((id) => find(`#${id}`).getAttribute('tether-state')),
    ['ready', 'ready'],
  );
});

test('a url: list without its parameter lists every product, or none unasked with emptyQuery or tether-empty-query', async () => {
  const { configure } = await import('../src/config.ts');
  answer = () =>
    jsonResponse({
      data: { products: { nodes: productsOf(['a']), pageInfo: { hasNextPage: false, endCursor: null } } },
    });
  const markup = (attribute = '') => `
    <div id="list" tether-products="url:q" ${attribute}>
      <div tether-list><div class="card"></div></div>
      <p id="empty" tether-show="list-empty" hidden>Type a search</p>
    </div>`;
  /** @param {string} attribute @returns {Promise<(string | null)[]>} */
  const shown = async (attribute = '') => {
    document.body.innerHTML = markup(attribute);
    await loadList(find('#list'));
    return cards();
  };
  try {
    assert.deepEqual(await shown(), ['a'], 'every product by default');
    assert.equal(calls.length, 1);
    configure({ domain: 'shop.test', token: 't', retries: 0, emptyQuery: 'none' });
    assert.deepEqual(await shown(), [], 'none with emptyQuery');
    assert.equal(calls.length, 1, 'and nothing asked');
    assert.equal(find('#list').getAttribute('tether-state'), 'ready');
    assert.notEqual(find('#empty').style.display, 'none', 'the empty state shows');
    assert.deepEqual(await shown('tether-empty-query="all"'), ['a'], 'the attribute over the config');
    assert.deepEqual(await shown('tether-empty-query="nothing"'), [], 'an unknown value: the config');
    assert.deepEqual(
      warnings.map((args) => args[1]),
      ['tether-empty-query "nothing" is not all or none: using none'],
    );
    window.history.replaceState(null, '', '/search?q=');
    assert.deepEqual(await shown(), [], 'an empty parameter is none too');
    assert.equal(calls.length, 2);
    window.history.replaceState(null, '', '/search?q=latte');
    await loadList(find('#list'));
    assert.deepEqual(cards(), ['a'], 'a load with a search lists it');
    assert.equal(calls.at(-1)?.variables['query'], 'latte');
    configure({ domain: 'shop.test', token: 't', retries: 0, emptyQuery: 'some' });
    assert.equal(warnings.at(-1)?.[1], 'invalid emptyQuery "some": using "all"');
  } finally {
    window.history.replaceState(null, '', '/');
    configure({ domain: 'shop.test', token: 't', retries: 0 });
  }
});
