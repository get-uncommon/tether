// `observe`: elements added to the page later are mounted on their own, not by rescanning the whole document.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { apparel, find, graphqlRequest, jsonResponse, product } from './fixtures.js';

const dom = new JSDOM('<!doctype html><body><span tether-cart-count></span><main></main></body>', {
  url: 'https://site.test/',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window.Option,
  getComputedStyle: dom.window.getComputedStyle,
});

/** @type {string[]} The handles each products request asked for. */
const requested = [];
globalThis.fetch = async (_url, init) => {
  const { variables } = graphqlRequest(init);
  const data = {};
  for (const [key, handle] of Object.entries(variables)) {
    if (!key.startsWith('h')) continue;
    requested.push(handle);
    data[key] = [product, apparel].find((candidate) => candidate.handle === handle) ?? null;
  }
  return jsonResponse({ data });
};

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let Tether;
let server;

before(async () => {
  ({ default: Tether } = await import('../src/index.ts'));
  server = await import('../src/server.ts');
  await Tether.init({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    observe: true,
    revalidate: false,
    country: 'NL',
  });
  Tether.mount(document);
});

/**
 * @param {() => Promise<void>} run
 * @returns {Promise<string[]>} The selectors queried on the whole document while `run` ran.
 */
async function documentQueries(run) {
  const selectors = [];
  const { querySelectorAll } = document;
  document.querySelectorAll = function (selector) {
    selectors.push(selector);
    return querySelectorAll.call(this, selector);
  };
  try {
    await run();
  } finally {
    document.querySelectorAll = querySelectorAll;
  }
  return selectors;
}

test('a burst of added cards mounts each card, reads only their hydrate tags and renders the cart once', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  const main = find('main');
  const selectors = await documentQueries(async () => {
    for (const handle of ['coffee-box', 'coffee-box', 'tee']) {
      const card = document.createElement('div');
      card.setAttribute('tether-product', handle);
      card.innerHTML = '<span tether-bind="title"></span>';
      main.append(card);
    }
    // The load-more fragment brings its own products.
    const hydrated = document.createElement('div');
    hydrated.innerHTML = shop.hydrate([product, apparel]);
    main.append(hydrated);
    await tick(120);
  });
  const titles = [...main.querySelectorAll('[tether-bind="title"]')].map((title) => title.textContent);
  assert.deepEqual(titles, [product.title, product.title, apparel.title]);
  assert.deepEqual(requested, [], 'the hydrate tag in the added elements was read: no request');
  assert.equal(
    selectors.filter((selector) => selector.includes('data-tether-hydrate')).length,
    0,
    'no document-wide scan for hydrate tags',
  );
  assert.equal(selectors.filter((selector) => selector === '[tether-cart-count]').length, 1, 'one cart render');
});

test('a hydrate entry without the lists a render walks is skipped, and the product loads instead', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  Tether.clearProductCache();
  requested.length = 0;
  const truncated = { id: apparel.id, handle: apparel.handle, title: apparel.title };
  const box = document.createElement('div');
  box.innerHTML = `${shop.hydrate(truncated)}<div tether-product="tee"><span tether-bind="title"></span></div>`;
  find('main').append(box);
  await tick(120);
  assert.deepEqual(requested, ['tee']);
  assert.equal(find('[tether-bind="title"]', box).textContent, apparel.title);
});
