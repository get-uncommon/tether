// Dynamic product pages (url:handle / url:path), not-found and error states, diagnose().
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  captureTetherWarnings,
  detailOf,
  find,
  graphqlRequest,
  jsonResponse,
  operationName,
  product,
} from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

// The failures these tests cause on purpose are checked through onError, states and events, not the console.
captureTetherWarnings();

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/product?handle=coffee-box' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window.Option,
  getComputedStyle: dom.window.getComputedStyle,
});

let mode = 'ok'; // 'ok' | 'down' | 'unauthorized' | 'malformed'
const calls = [];
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  const op = operationName(query);
  calls.push({ op, variables });
  if (mode === 'down') throw new TypeError('fetch failed');
  if (mode === 'unauthorized') return jsonResponse({ errors: [{ message: 'Unauthorized' }] }, 401);
  const ok = (data) => jsonResponse({ data });
  if (mode === 'malformed' && op === 'TetherProducts') return ok({ h0: { ...product, variants: null } });
  if (mode === 'malformed' && op.startsWith('Tether_cart')) {
    return ok({ [op.slice('Tether_'.length)]: { cart: { id: 'gid://shopify/Cart/1', lines: null }, userErrors: [] } });
  }
  if (op === 'TetherProducts') {
    const data = {};
    Object.keys(variables).forEach((k) => {
      if (k.startsWith('h')) data[k] = variables[k] === product.handle ? product : null;
    });
    return ok(data);
  }
  if (op === 'TetherDiagnose')
    return ok({
      shop: {
        name: 'Test shop',
        primaryDomain: { url: 'https://shop.test' },
        paymentSettings: { currencyCode: 'EUR' },
      },
    });
  if (op === 'TetherCart') return ok({ cart: null });
  throw new Error(`unexpected op ${op}`);
};

/** Waits until the first element matching `selector` is in `state`. */
const waitForState = (state, selector = '[tether-product]') =>
  waitFor(() => find(selector)?.getAttribute('tether-state') === state, `${selector} to be ${state}`);
const go = (url) => dom.reconfigure({ url });
let Tether;
const errors = [];

before(async () => {
  ({ default: Tether } = await import('../src/index.ts'));
  await Tether.init({
    domain: 'shop.test',
    token: 'public-token-123',
    autoMount: false,
    retries: 0,
    productPath: '/product?handle={handle}',
    onError: (err, ctx) => errors.push({ err, ctx }),
  });
});

beforeEach(() => {
  mode = 'ok';
  calls.length = 0;
  errors.length = 0;
  Tether.clearProductCache();
});

const page = (key, extra = '') => `
  <div tether-product="${key}" ${extra}>
    <div id="loading" tether-show="loading">Loading…</div>
    <div id="ready" tether-show="ready"><h1 tether-bind="title"></h1><a id="link" tether-bind="link"></a></div>
    <div id="nf" tether-show="not-found">This product doesn't exist</div>
    <div id="err" tether-show="error">Shop is unavailable</div>
    <button id="add" tether-add-to-cart>Add</button>
  </div>`;

const visible = (id) => find(`#${id}`).style.display !== 'none';

test('resolveProductKey: url:handle, any param, url:path, plain values', () => {
  const el = document.createElement('div');
  const key = (v, url) => {
    el.setAttribute('tether-product', v);
    return Tether.resolveProductKey(el, new URL(url)).key;
  };
  assert.equal(key('url:handle', 'https://x.test/product?handle=coffee-box'), 'coffee-box');
  assert.equal(key('url:p', 'https://x.test/shop?p=beans'), 'beans');
  assert.equal(key('url:path', 'https://x.test/shop/coffee%20box/'), 'coffee box');
  assert.equal(key('url:handle', 'https://x.test/product'), null);
  assert.equal(key('coffee-box', 'https://x.test/'), 'coffee-box');
});

test('dynamic product page renders the product from ?handle=', async () => {
  go('https://site.test/product?handle=coffee-box');
  document.body.innerHTML = page('url:handle', 'tether-page-title="{title} | Shop"');
  Tether.mount(document);
  const root = find('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'loading');
  assert.ok(visible('loading'));
  assert.ok(!visible('nf') && !visible('err'));
  await waitForState('ready');
  assert.equal(root.getAttribute('tether-state'), 'ready');
  assert.equal(find('h1').textContent, 'Coffee Box');
  assert.ok(visible('ready') && !visible('loading') && !visible('nf') && !visible('err'));
  assert.equal(find('#link').getAttribute('href'), '/product?handle=coffee-box');
  assert.equal(document.title, 'Coffee Box | Shop');
});

test('url:path takes the last path segment', async () => {
  go('https://site.test/shop/coffee-box');
  document.body.innerHTML = page('url:path');
  Tether.mount(document);
  await waitForState('ready');
  assert.equal(find('h1').textContent, 'Coffee Box');
});

test('unknown handle shows not-found, disables add to cart, no onError for URL typos', async () => {
  go('https://site.test/product?handle=nope');
  document.body.innerHTML = page('url:handle');
  const notFound = [];
  document.addEventListener('tether:product-not-found', (e) => notFound.push(detailOf(e)), { once: true });
  Tether.mount(document);
  await waitForState('error');
  const root = find('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'error');
  assert.equal(root.getAttribute('tether-error'), 'not-found');
  assert.ok(visible('nf') && !visible('err') && !visible('ready') && !visible('loading'));
  assert.equal(find('#add').hasAttribute('disabled'), true);
  assert.equal(notFound[0].key, 'nope');
  assert.equal(errors.length, 0);
});

test('missing ?handle= is not-found without a request', async () => {
  go('https://site.test/product');
  document.body.innerHTML = page('url:handle');
  Tether.mount(document);
  await waitForState('error');
  assert.ok(visible('nf'));
  assert.equal(calls.filter((c) => c.op === 'TetherProducts').length, 0);
});

test('a CMS-bound handle that no longer exists is reported to onError', async () => {
  document.body.innerHTML = page('deleted-product');
  Tether.mount(document);
  await waitForState('error');
  assert.ok(visible('nf'));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].err.code, 'NOT_FOUND');
});

test('API down: error state, onError called, blocks hidden by a class still appear', async () => {
  mode = 'down';
  document.head.innerHTML = '<style>.hidden { display: none; }</style>';
  document.body.innerHTML = page('coffee-box').replace('id="err"', 'id="err" class="hidden"');
  Tether.mount(document);
  await waitForState('error');
  const root = find('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'error');
  assert.equal(root.getAttribute('tether-error'), 'NETWORK');
  assert.ok(visible('err') && !visible('nf') && !visible('ready'));
  assert.equal(getComputedStyle(find('#err')).display, 'block');
  assert.equal(errors[0].err.code, 'NETWORK');
  assert.equal(find('#add').hasAttribute('disabled'), true);
});

test('list error state', async () => {
  mode = 'down';
  document.body.innerHTML = `<div tether-collection="coffee">
    <div tether-list><div><span tether-bind="title"></span></div></div>
    <div id="lerr" tether-show="error">Couldn't load products</div>
  </div>`;
  Tether.mount(document);
  await waitForState('error', '[tether-collection]');
  assert.equal(find('[tether-collection]').getAttribute('tether-state'), 'error');
  assert.ok(visible('lerr'));
});

test('cart-error shows after a failed cart call', async () => {
  document.body.innerHTML = '<div id="cerr" tether-show="cart-error">Cart unavailable</div>';
  Tether.cart.render();
  assert.ok(!visible('cerr'));
  mode = 'down';
  await assert.rejects(Tether.cart.add({ variantId: '10' }));
  assert.ok(visible('cerr'));
});

test('a Storefront answer missing fields Tether reads is a TetherError, not a crash in the render', async () => {
  mode = 'malformed';
  document.body.innerHTML = page('coffee-box');
  Tether.mount(document);
  await waitFor(() => find('[tether-product]').getAttribute('tether-state') === 'error', 'the error state');
  assert.equal(errors[0].err.name, 'TetherError');
  assert.equal(errors[0].err.message, 'Invalid response (200)');
  await assert.rejects(Tether.cart.add({ variantId: '10' }), {
    name: 'TetherError',
    message: 'Invalid response (200)',
  });
});

test('diagnose reports config, reachability, plans and markup problems', async () => {
  go('https://site.test/product');
  document.body.innerHTML = `
    <div tether-product="coffee-box"></div>
    <div tether-product=""></div>
    <div tether-product="url:handle"></div>
    <span tether-bind="title"></span>
    <span tether-show="in-stok"></span>
    <div tether-product="coffee-box"><span tether-bind="metafield:custom.nope"></span></div>`;
  const r = await Tether.diagnose({ silent: true, now: new Date('2026-11-04') });
  assert.equal(
    r.version,
    JSON.parse((await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  );
  assert.equal(r.reachable, true);
  assert.equal(r.shop.name, 'Test shop');
  assert.match(r.config.token, /^publ…-123/);
  assert.equal(r.apiVersion.ok, true);
  assert.equal(r.sellingPlans.length, 2);
  const msgs = r.problems.map((p) => p.message).join('\n');
  assert.match(msgs, /has no value/);
  assert.match(msgs, /this URL has no value/);
  assert.match(msgs, /tether-bind outside any tether-product/);
  assert.match(msgs, /Unknown tether-show="in-stok"/);
  assert.match(msgs, /custom\.nope" is not in config\.metafields/);
  assert.match(msgs, /in-stok"\. Did you mean "in-stock"/);
});

test('diagnose: documented values pass, typos get a did-you-mean', async () => {
  document.body.innerHTML = `
    <div tether-search><p tether-show="search-empty"></p><p tether-show="search-results"></p><div tether-search-results><a></a></div></div>
    <p tether-show="logged-in"></p><p tether-show="logged-out"></p>
    <div tether-product="coffee-box">
      <span tether-bind="price"></span><img tether-bind="image:2"><span tether-bind="pric"></span>
      <span tether-bnd="title"></span><button tether-add-to-card>Add</button><button tether-add-to-cart>Add</button>
      <div tether-option-list="Sise"><button></button></div>
      <div tether-option-list="Size"><button></button></div>
      <div tether-plan-list></div>
    </div>`;
  const r = await Tether.diagnose({ silent: true, now: new Date('2026-11-04') });
  const msgs = r.problems.map((p) => p.message).join('\n');
  assert.doesNotMatch(msgs, /Unknown tether-show|bind="price"|image:2/);
  assert.match(msgs, /tether-bind="pric".*Did you mean "price"/);
  assert.match(msgs, /tether-bnd.*Did you mean "tether-bind"/);
  assert.match(msgs, /tether-add-to-card.*Did you mean "tether-add-to-cart"/);
  assert.match(msgs, /no option "Sise".*Did you mean "Size"/);
  assert.match(msgs, /tether-plan-list without a template child/);
  assert.doesNotMatch(msgs, /: \.|undefined/);
});

test('diagnose explains a rejected token and an expired API version', async () => {
  mode = 'unauthorized';
  document.body.innerHTML = '';
  const r = await Tether.diagnose({ silent: true, now: new Date('2028-01-01') });
  assert.equal(r.reachable, false);
  const msgs = r.problems.map((p) => p.message).join('\n');
  assert.match(msgs, /rejected the Storefront token/);
  assert.match(msgs, /no longer supported/);
});

test('API versions: next quarterly version, support window, unstable refused', async () => {
  const { nextApiVersion, apiVersionStatus } = await import('../src/api-version.ts');
  assert.equal(nextApiVersion('2026-07'), '2026-10');
  assert.equal(nextApiVersion('2026-10'), '2027-01');
  assert.equal(nextApiVersion('2026-10', 2), '2027-04');
  assert.throws(() => nextApiVersion('unstable'));
  assert.equal(apiVersionStatus('unstable').ok, false);
  assert.match(apiVersionStatus('unstable').note, /pin a dated version/);
  const close = apiVersionStatus('2026-01', new Date('2026-11-15'));
  assert.equal(close.ok, true);
  assert.match(close.note, /plan the upgrade to 2026-04/);
  assert.equal(apiVersionStatus('2026-07', new Date('2026-11-04')).next, '2026-10');
});

test('back online: failed products load again by themselves', async () => {
  mode = 'down';
  document.body.innerHTML = page('coffee-box');
  Tether.mount(document);
  await waitForState('error');
  const root = find('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'error');
  assert.equal(find('#add').getAttribute('aria-disabled'), 'true');
  mode = 'ok';
  window.dispatchEvent(new window.Event('online'));
  await waitForState('ready');
  assert.equal(root.getAttribute('tether-state'), 'ready');
  assert.equal(find('h1').textContent, 'Coffee Box');
  assert.equal(find('#add').getAttribute('aria-disabled'), 'false');
});
