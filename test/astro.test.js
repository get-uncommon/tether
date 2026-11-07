// The server module, hydration of server-rendered data, Astro View Transitions and cart.subscribe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tether, calls, queuedRequestsSent, server, setLivePrice } from './astro-harness.js';
import { find, jsonResponse, product } from './fixtures.js';
import { fieldOf, parseJson, recordsAt, waitFor } from '../server/test/mocks.js';

test('server: createStorefront(import.meta.env) maps the PUBLIC_SHOPIFY_* names and ignores other keys', () => {
  const importMetaEnv = {
    PUBLIC_SHOPIFY_DOMAIN: 'https://x.myshopify.com/',
    PUBLIC_SHOPIFY_STOREFRONT_TOKEN: 'tok',
    MODE: 'production',
    BASE_URL: '/',
  };
  const shop = server.createStorefront(importMetaEnv);
  assert.equal(shop.config.domain, 'x.myshopify.com');
  assert.equal(shop.config.token, 'tok');
  assert.ok(!('MODE' in shop.config));
  assert.throws(() => server.createStorefront({}), /needs domain and token/);
});

test('server: the config is resolved as the browser’s: an invalid count falls back to its default', () => {
  // @ts-expect-error -- the invalid count this test passes on purpose
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', imagesFirst: -1, variantsFirst: 'many' });
  assert.equal(shop.config.imagesFirst, 25);
  assert.equal(shop.config.variantsFirst, 100);
});

test('server: same product query as the browser, so hydrated data has the same shape', async () => {
  const { productFragment } = await import('../src/fragments.ts');
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', fetch: globalThis.fetch });
  await shop.getProduct('coffee-box');
  assert.ok(calls[0]?.query.includes(productFragment(shop.config)));
  assert.equal(productFragment(shop.config), productFragment(), 'same defaults as the browser config');
});

test('server: pageSize is an integer from 1 to 250, and anything else warns and uses 25', () => {
  /** @type {string[]} */
  const warned = [];
  const { warn } = console;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    const pageSize = (/** @type {unknown} */ value) =>
      // @ts-expect-error -- the invalid sizes this test passes on purpose
      server.createStorefront({ domain: 'shop.test', token: 't', pageSize: value }).config.pageSize;
    assert.deepEqual([1, 250, undefined].map(pageSize), [1, 250, 25]);
    assert.deepEqual([0, 251, 2.5, '50'].map(pageSize), [25, 25, 25, 25]);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warned, [
    '[tether] invalid pageSize 0: using 25',
    '[tether] invalid pageSize 251: using 25',
    '[tether] invalid pageSize 2.5: using 25',
    '[tether] invalid pageSize "50": using 25',
  ]);
});

test('server: getProduct by handle / id / URL, null when missing; allProducts pages through everything', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', pageSize: 2 });
  assert.equal((await shop.getProduct('coffee-box'))?.title, 'Coffee Box');
  assert.equal((await shop.getProduct('1'))?.handle, 'coffee-box');
  assert.equal((await shop.getProduct('https://shop.test/products/coffee-box?x=1'))?.handle, 'coffee-box');
  assert.equal(await shop.getProduct('nope'), null);
  const all = await shop.allProducts();
  assert.deepEqual(
    all.map((listed) => listed.handle),
    ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
  );
  assert.equal(calls.filter((call) => call.op === 'TetherServerProducts').length, 3);
});

test('server: formatMoney, productUrl, plans helpers', () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', locale: 'nl-NL', productPath: '/products' });
  assert.match(shop.formatMoney({ amount: '30.0', currencyCode: 'EUR' }), /30,00/);
  assert.equal(shop.productUrl('coffee-box'), '/products/coffee-box');
  assert.equal(server.productUrl('a b', { productPath: '/p?handle={handle}' }), '/p?handle=a%20b');
  assert.equal(shop.plans.allPlans(product).length, 2);
});

test('server: productUrl encodes the handle and gives no URL without the handle or id the path needs', () => {
  assert.equal(server.productUrl('a/b', { productPath: '/products/' }), '/products/a%2Fb');
  assert.equal(server.productUrl('', { productPath: '/products' }), null);
  // @ts-expect-error -- a product without a handle, as a CMS can hand over
  assert.equal(server.productUrl(null, { productPath: '/products' }), null);
  assert.equal(server.productUrl('x', { productPath: '/p/{id}' }), null);
  assert.equal(server.productUrl('', { productPath: '/p/{id}', id: 'gid://shopify/Product/7' }), '/p/7');
});

test('server: hydrate() escapes </script> and carries the market', () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  const evil = { ...product, title: '</script><script>alert(1)</script>' };
  const tag = shop.hydrate(evil);
  assert.equal((tag.match(/<\/script>/g) ?? []).length, 1, 'only the real closing tag');
  const json = parseJson(tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
  assert.equal(fieldOf(json, 'country'), 'NL');
  assert.equal(fieldOf(recordsAt(json, 'products')[0], 'title'), evil.title);
});

/** @param {string} tag */
const page = (tag) => `${tag}
  <div tether-product="coffee-box"><h1 tether-bind="title">Coffee Box</h1><span id="price" tether-bind="price">€ 30,00</span></div>`;

test('hydration: server-rendered product renders with no request, then one background refresh updates it', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  setLivePrice('30');
  const serverCopy = await shop.getProduct('coffee-box');
  calls.length = 0;
  setLivePrice('25'); // the price changed after the build
  document.body.innerHTML = page(shop.hydrate(serverCopy));
  Tether.mount(document);
  await Promise.resolve();
  await Promise.resolve();
  const root = find('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'ready', 'rendered from the server data, no loading state');
  assert.match(find('#price').textContent, /30/);
  await waitFor(() => find('#price').textContent.includes('25'), 'the background refresh');
  assert.equal(calls.filter((call) => call.op === 'TetherProducts').length, 1, 'exactly one background refresh');
  assert.match(find('#price').textContent, /25/, 'live price after the refresh');
});

test('hydration: the next page of a View Transition visit keeps the copy loaded a moment ago', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  setLivePrice('30');
  const old = await shop.getProduct('coffee-box'); // built earlier, now outdated
  setLivePrice('22');
  calls.length = 0;
  // page 1 refreshed the product a moment ago (the test above, or here: a fresh mount)
  document.body.innerHTML = page(shop.hydrate(old));
  Tether.mount(document);
  await waitFor(() => find('#price').textContent.includes('22'), "page 1's refresh");
  const before = calls.filter((call) => call.op === 'TetherProducts').length;
  // page 2 carries the same stale build data
  Tether.unmount();
  document.body.innerHTML = page(shop.hydrate(old));
  Tether.mount(document);
  await queuedRequestsSent();
  assert.equal(calls.filter((call) => call.op === 'TetherProducts').length, before, 'no second refresh');
  assert.match(find('#price').textContent, /22/, 'shows the live copy, not the build');
});

test('hydration: a server-rendered image with the same URL is not loaded again', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  const served = await shop.getProduct('coffee-box');
  assert.ok(served);
  const url = served.featuredImage?.url || served.images.nodes[0]?.url;
  if (!url) return; // mock without images
  const src = shop.imageUrl(url, { width: 800 });
  document.body.innerHTML = `${shop.hydrate(served)}<div tether-product="coffee-box"><img id="im" tether-bind="image" src="${src}" alt="x"></div>`;
  const img = find('#im');
  Tether.mount(document);
  await queuedRequestsSent();
  assert.equal(find('#im'), img);
  assert.equal(img.getAttribute('src'), src, 'src untouched');
});

test('hydration: data made for another market is ignored (Tether fetches its own)', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'DE' });
  document.body.innerHTML = page(shop.hydrate(product));
  Tether.mount(document);
  await waitFor(() => calls.some((call) => call.op === 'TetherProducts'), 'the request for this market');
  assert.equal(calls.filter((call) => call.op === 'TetherProducts').length, 1);
});

test('hydration: revalidate:false skips the background refresh', async () => {
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', revalidate: false });
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  document.body.innerHTML = page(shop.hydrate(product));
  Tether.mount(document);
  await queuedRequestsSent();
  assert.equal(calls.length, 0);
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', locale: 'nl-NL' });
});

test('astro:page-load mounts the new page; astro:before-swap closes the cart', async () => {
  document.body.innerHTML = '<div tether-cart-drawer></div>';
  Tether.cart.open();
  document.dispatchEvent(new window.Event('astro:before-swap'));
  assert.equal(Tether.cart.isOpen(), false);
  document.body.innerHTML = '<div tether-product="coffee-box"><h1 tether-bind="title"></h1></div>';
  document.dispatchEvent(new window.Event('astro:page-load'));
  await waitFor(() => find('h1').textContent === 'Coffee Box', 'the new page to mount');
});

test('cart.subscribe gives the cart now and after every change; unsubscribe stops it', async () => {
  localStorage.clear();
  /** @type {number[]} */
  const seen = [];
  const off = Tether.cart.subscribe((_cart, meta) => seen.push(meta.count));
  await Tether.cart.add({ variantId: '10' });
  off();
  const before = seen.length;
  await Tether.cart.add({ variantId: '10' });
  assert.deepEqual(seen.slice(0, 2), [0, 1]);
  assert.equal(seen.length, before, 'nothing after unsubscribe');
});

test('a rejected token says why: Shopify sends 401 with an empty message', async () => {
  const fetch = async () => jsonResponse({ errors: [{ message: '', extensions: { code: 'UNAUTHORIZED' } }] }, 401);
  const shop = server.createStorefront({ domain: 'wrong.myshopify.com', token: 'shpat_abc', fetch });
  await assert.rejects(shop.getProduct('x'), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /rejected the Storefront token for wrong\.myshopify\.com \(401\)/);
    assert.match(error.message, /not an Admin API token/);
    return true;
  });
  const empty = server.createStorefront({
    domain: 'wrong.myshopify.com',
    token: 't',
    fetch: async () => new Response('not json', { status: 403 }),
  });
  await assert.rejects(empty.getProduct('x'), /rejected the Storefront token .*\(403\)/);
});
