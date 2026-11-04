// Dynamic product pages (url:handle / url:path), not-found and error states, diagnose().
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { product } from './fixtures.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/product?handle=coffee-box' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver,
  Option: dom.window.Option, getComputedStyle: dom.window.getComputedStyle,
});

let mode = 'ok'; // 'ok' | 'down' | 'unauthorized'
const calls = [];
globalThis.fetch = async (url, init) => {
  const { query, variables } = JSON.parse(init.body);
  const op = query.match(/(?:query|mutation)\s+(\w+)/)[1];
  calls.push({ op, variables });
  if (mode === 'down') throw new TypeError('fetch failed');
  if (mode === 'unauthorized') return { ok: false, status: 401, json: async () => ({ errors: [{ message: 'Unauthorized' }] }) };
  const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
  if (op === 'TetherProducts') {
    const data = {};
    Object.keys(variables).forEach((k) => { if (k.startsWith('h')) data[k] = variables[k] === product.handle ? product : null; });
    return ok(data);
  }
  if (op === 'TetherDiagnose') return ok({ shop: { name: 'Test shop', primaryDomain: { url: 'https://shop.test' }, paymentSettings: { currencyCode: 'EUR' } } });
  if (op === 'TetherCart') return ok({ cart: null });
  throw new Error(`unexpected op ${op}`);
};

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const go = (url) => dom.reconfigure({ url });
let Tether;
const errors = [];

before(async () => {
  ({ default: Tether } = await import('../src/index.js'));
  await Tether.init({
    domain: 'shop.test', token: 'public-token-123', autoMount: false, retries: 0,
    productPath: '/product?handle={handle}', onError: (err, ctx) => errors.push({ err, ctx }),
  });
});

beforeEach(() => { mode = 'ok'; calls.length = 0; errors.length = 0; Tether.clearProductCache(); });

const page = (key, extra = '') => `
  <div tether-product="${key}" ${extra}>
    <div id="loading" tether-show="loading">Loading…</div>
    <div id="ready" tether-show="ready"><h1 tether-bind="title"></h1><a id="link" tether-bind="link"></a></div>
    <div id="nf" tether-show="not-found">This product doesn't exist</div>
    <div id="err" tether-show="error">Shop is unavailable</div>
    <button id="add" tether-add-to-cart>Add</button>
  </div>`;

const visible = (id) => document.getElementById(id).style.display !== 'none';

test('resolveProductKey: url:handle, any param, url:path, plain values', () => {
  const el = document.createElement('div');
  const key = (v, url) => { el.setAttribute('tether-product', v); return Tether.resolveProductKey(el, new URL(url)).key; };
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
  const root = document.querySelector('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'loading');
  assert.ok(visible('loading'));
  assert.ok(!visible('nf') && !visible('err'));
  await tick();
  assert.equal(root.getAttribute('tether-state'), 'ready');
  assert.equal(document.querySelector('h1').textContent, 'Coffee Box');
  assert.ok(visible('ready') && !visible('loading') && !visible('nf') && !visible('err'));
  assert.equal(document.getElementById('link').getAttribute('href'), '/product?handle=coffee-box');
  assert.equal(document.title, 'Coffee Box | Shop');
});

test('url:path takes the last path segment', async () => {
  go('https://site.test/shop/coffee-box');
  document.body.innerHTML = page('url:path');
  Tether.mount(document);
  await tick();
  assert.equal(document.querySelector('h1').textContent, 'Coffee Box');
});

test('unknown handle shows not-found, disables add to cart, no onError for URL typos', async () => {
  go('https://site.test/product?handle=nope');
  document.body.innerHTML = page('url:handle');
  let notFound = null;
  document.addEventListener('tether:product-not-found', (e) => { notFound = e.detail; }, { once: true });
  Tether.mount(document);
  await tick();
  const root = document.querySelector('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'error');
  assert.equal(root.getAttribute('tether-error'), 'not-found');
  assert.ok(visible('nf') && !visible('err') && !visible('ready') && !visible('loading'));
  assert.equal(document.getElementById('add').disabled, true);
  assert.equal(notFound.key, 'nope');
  assert.equal(errors.length, 0);
});

test('missing ?handle= is not-found without a request', async () => {
  go('https://site.test/product');
  document.body.innerHTML = page('url:handle');
  Tether.mount(document);
  await tick();
  assert.ok(visible('nf'));
  assert.equal(calls.filter((c) => c.op === 'TetherProducts').length, 0);
});

test('a CMS-bound handle that no longer exists is reported to onError', async () => {
  document.body.innerHTML = page('deleted-product');
  Tether.mount(document);
  await tick();
  assert.ok(visible('nf'));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].err.code, 'NOT_FOUND');
});

test('API down: error state, onError called, blocks hidden by a class still appear', async () => {
  mode = 'down';
  document.head.innerHTML = '<style>.hidden { display: none; }</style>';
  document.body.innerHTML = page('coffee-box').replace('id="err"', 'id="err" class="hidden"');
  Tether.mount(document);
  await tick();
  const root = document.querySelector('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'error');
  assert.equal(root.getAttribute('tether-error'), 'NETWORK');
  assert.ok(visible('err') && !visible('nf') && !visible('ready'));
  assert.equal(getComputedStyle(document.getElementById('err')).display, 'block');
  assert.equal(errors[0].err.code, 'NETWORK');
  assert.equal(document.getElementById('add').disabled, true);
});

test('list error state', async () => {
  mode = 'down';
  document.body.innerHTML = `<div tether-collection="coffee">
    <div tether-list><div><span tether-bind="title"></span></div></div>
    <div id="lerr" tether-show="error">Couldn't load products</div>
  </div>`;
  Tether.mount(document);
  await tick();
  assert.equal(document.querySelector('[tether-collection]').getAttribute('tether-state'), 'error');
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
  assert.equal(r.version, '0.3.0');
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
});

test('diagnose explains a rejected token and an expired API version', async () => {
  mode = 'unauthorized';
  document.body.innerHTML = '';
  const r = await Tether.diagnose({ silent: true, now: new Date('2028-01-01') });
  assert.equal(r.reachable, false);
  const msgs = r.problems.map((p) => p.message).join('\n');
  assert.match(msgs, /Token rejected/);
  assert.match(msgs, /no longer supported/);
});

test('API versions: next quarterly version, support window, unstable refused', async () => {
  const { nextApiVersion, apiVersionStatus } = await import('../src/api-version.js');
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
