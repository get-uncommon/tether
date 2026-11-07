// Search as you type: input → predictive query → rendered results, keyboard, errors.
import { test, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { captureTetherWarnings, detailOf, find, graphqlRequest, jsonResponse, operationName } from './fixtures.js';
import { stringAt, waitFor } from '../server/test/mocks.js';

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

/** @type {{ op: string, variables: Record<string, unknown> }[]} */
const calls = [];
let failNext = false;
/**
 * @param {RequestInfo | URL} _url
 * @param {RequestInit} [init]
 */
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  calls.push({ op: operationName(query), variables });
  if (failNext) {
    failNext = false;
    return jsonResponse({}, 500);
  }
  if (variables['q'] === 'nothing') return jsonResponse({ data: { predictiveSearch: null } });
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
        queries: [{ text: variables['q'] }, { text: `${stringAt(variables, 'q')} beans` }],
      },
    },
  });
};

/**
 * Types `value` and runs the search timer at once (`searchDelay` is 0), for input that must not start a search: a
 * search that starts sets the `loading` state before its first await.
 *
 * @param {HTMLInputElement} input
 * @param {string} value
 */
function typeAndRunTimer(input, value) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    type(input, value);
    mock.timers.runAll();
  } finally {
    mock.timers.reset();
  }
}
/** @type {string[]} */
const errors = [];
/** @type {typeof import('../src/search.ts').mountSearch} */
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

/**
 * @param {HTMLInputElement} input
 * @param {string} value
 */
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

  /** @type {{ term: string }[]} */
  const searches = [];
  root.addEventListener('tether:search', (event) => searches.push({ term: stringAt(detailOf(event), 'term') }));
  typeAndRunTimer(input, 'c');
  assert.equal(calls.length, 0, 'below the minimum length');
  assert.equal(root.getAttribute('tether-search-state'), 'idle');

  type(input, 'cof');
  await waitFor(() => root.getAttribute('tether-search-state') === 'ready', 'the results');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.variables, { q: 'cof', limit: 4 });
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
  assert.deepEqual(
    queries.map((link) => link.getAttribute('role')),
    ['option'],
    'a suggestion is an option of the listbox',
  );
  assert.equal(find('[tether-search-collections] a', root).getAttribute('href'), '/collection/coffee');
  assert.equal(find('[tether-show="search-empty"]', root).style.display, 'none');
  assert.equal(searches.at(-1)?.term, 'cof');

  typeAndRunTimer(input, 'cof');
  assert.equal(root.getAttribute('tether-search-state'), 'ready');
  assert.equal(calls.length, 1, 'the same term is not searched again');
});

test('arrow keys move through the options, Escape closes', () => {
  const root = find('[tether-search]');
  const input = root.querySelector('input');
  assert.ok(input);
  /** @param {string} name */
  const key = (name) => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true }));
  const options = [...root.querySelectorAll('[role="option"]')];
  assert.equal(options.length, 3, 'the product, the suggestion and the collection');
  key('ArrowDown');
  assert.equal(input.getAttribute('aria-activedescendant'), options[0]?.id);
  key('ArrowDown');
  assert.equal(input.getAttribute('aria-activedescendant'), options[1]?.id, 'the suggestion');
  key('ArrowUp');
  key('ArrowUp');
  assert.equal(input.getAttribute('aria-activedescendant'), options[2]?.id, 'wraps around');
  key('Escape');
  assert.ok(!root.classList.contains('is-open'));
  assert.equal(input.hasAttribute('aria-activedescendant'), false);
});

test('a failed search sets the error state and reaches onError', async () => {
  const root = find('[tether-search]');
  const input = root.querySelector('input');
  assert.ok(input);
  failNext = true;
  type(input, 'tea');
  await waitFor(() => root.getAttribute('tether-search-state') === 'error', 'the error state');
  assert.equal(root.getAttribute('tether-search-state'), 'error');
  assert.deepEqual(errors, ['search']);
});

test('new results clear aria-activedescendant: no option is selected in them', async () => {
  const root = find('[tether-search]');
  const input = root.querySelector('input');
  assert.ok(input);
  type(input, 'cof');
  await waitFor(() => root.getAttribute('tether-search-state') === 'ready', 'the results');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.ok(input.hasAttribute('aria-activedescendant'));
  root.removeAttribute('tether-search-state');
  type(input, 'coff');
  await waitFor(() => root.getAttribute('tether-search-state') === 'ready', 'the new results');
  assert.equal(input.hasAttribute('aria-activedescendant'), false);
  assert.deepEqual(
    [...root.querySelectorAll('[role="option"]')].map((option) => option.getAttribute('aria-selected')),
    ['false', 'false', 'false'],
  );
});

test('Enter after Escape submits the form: the closed list has no selected option to open', async () => {
  const root = find('[tether-search]');
  const input = root.querySelector('input');
  assert.ok(input);
  root.removeAttribute('tether-search-state');
  type(input, 'cofe');
  await waitFor(() => root.getAttribute('tether-search-state') === 'ready', 'the results');
  /** @param {string} name */
  const key = (name) =>
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  /** @type {EventTarget[]} */
  const clicked = [];
  /** @param {Event} event */
  const record = (event) => {
    if (event.target) clicked.push(event.target);
    event.preventDefault();
  };
  root.addEventListener('click', record);
  try {
    key('ArrowDown');
    key('Escape');
    assert.equal(root.querySelector('[aria-selected="true"]'), null);
    assert.equal(key('Enter'), true, 'the form submits');
    assert.deepEqual(clicked, []);
  } finally {
    root.removeEventListener('click', record);
  }
});

test('a term without results is not searched again', async () => {
  const root = find('[tether-search]');
  const input = root.querySelector('input');
  assert.ok(input);
  for (const term of ['nothing', 'cofg', 'nothing']) {
    root.removeAttribute('tether-search-state');
    type(input, term);
    await waitFor(() => root.hasAttribute('tether-search-state'), `the results for ${term}`);
  }
  assert.equal(root.getAttribute('tether-search-state'), 'empty');
  assert.deepEqual(
    calls.slice(-2).map((call) => call.variables['q']),
    ['nothing', 'cofg'],
  );
});

test('a term searched again in another market is sent again: its prices are that market’s', async () => {
  const { cfg } = await import('../src/config.ts');
  const { toCountry } = await import('../src/market-codes.ts');
  const root = find('[tether-search]');
  const input = root.querySelector('input');
  assert.ok(input);
  for (const term of ['cofa', 'cofb']) {
    root.removeAttribute('tether-search-state');
    type(input, term);
    await waitFor(() => root.getAttribute('tether-search-state') === 'ready', `the results for ${term}`);
  }
  const sent = calls.length;
  cfg.country = toCountry('US') ?? undefined;
  try {
    root.removeAttribute('tether-search-state');
    type(input, 'cofa');
    await waitFor(() => root.getAttribute('tether-search-state') === 'ready', 'the results in US');
    assert.equal(calls.length, sent + 1);
  } finally {
    cfg.country = undefined;
  }
});

/**
 * Records the signal of each `document` click listener `run` adds.
 *
 * @param {() => void} run
 * @returns {AbortSignal[]}
 */
function clickListenerSignals(run) {
  const spy = mock.method(document, 'addEventListener');
  try {
    run();
  } finally {
    spy.mock.restore();
  }
  return spy.mock.calls.flatMap(({ arguments: [name, , options] }) =>
    name === 'click' && typeof options === 'object' && options.signal ? [options.signal] : [],
  );
}

/** @param {AbortSignal[]} signals */
const stopped = (signals) => signals.map((signal) => signal.aborted);

test('a search box a page swap removed stops listening on document; one that comes back mounts again', () => {
  document.body.innerHTML = markup;
  const first = find('[tether-search]');
  const [firstSignal] = clickListenerSignals(() => {
    mountSearch(document);
  });
  assert.ok(firstSignal);
  document.body.innerHTML = markup;
  const [secondSignal] = clickListenerSignals(() => {
    mountSearch(document);
  });
  assert.ok(secondSignal, 'the new page has its own box');
  assert.deepEqual(stopped([firstSignal, secondSignal]), [true, false], 'the swapped-out box no longer listens');
  document.body.replaceChildren(first);
  const [thirdSignal] = clickListenerSignals(() => {
    mountSearch(document);
  });
  assert.ok(thirdSignal, 'the box that comes back mounts afresh');
  assert.deepEqual(stopped([secondSignal, thirdSignal]), [true, false]);
});

test('a click after a page swap stops a box no mount has pruned yet', () => {
  document.body.innerHTML = markup;
  const signals = clickListenerSignals(() => {
    mountSearch(document);
  });
  document.body.innerHTML = '<p>A page without search</p>';
  find('p').click();
  assert.deepEqual(stopped(signals), [true]);
});
