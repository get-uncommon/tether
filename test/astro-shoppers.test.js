// What store builders and their shoppers ran into: quick cart clicks, options, variant URLs, search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Tether,
  firstVariant,
  calls,
  fieldOf,
  firstVariantId,
  productScope,
  rendered,
  seedCart,
  server,
} from './astro-harness.js';
import { cartFrom, find, graphqlRequest, jsonResponse, product } from './fixtures.js';
import { listAt, numberAt, parseJson, recordAt, recordsAt, waitFor } from '../server/test/mocks.js';

test('cart: quick +/+ clicks add up (each builds on the last one asked for), the line is busy meanwhile', async () => {
  const cart = cartFrom([{ merchandiseId: firstVariantId, quantity: 1 }]);
  await seedCart(cart);
  document.body.innerHTML = `<div tether-cart-lines><div><span tether-line="quantity"></span><button tether-line-plus>+</button></div></div>`;
  Tether.cart.render();
  const line = find('[tether-cart-lines] > *');
  const plus = find('[tether-line-plus]', line);
  plus.click();
  plus.click();
  assert.equal(find('[tether-line="quantity"]', line).textContent, '3', 'shown at once');
  assert.ok(line.classList.contains('is-busy'));
  await waitFor(() => !find('[tether-cart-lines] > *').classList.contains('is-busy'), 'the update to finish');
  const updates = calls
    .filter((call) => call.op === 'Tether_cartLinesUpdate')
    .map((call) => numberAt(recordsAt(call.variables, 'lines')[0], 'quantity'));
  assert.deepEqual(updates, [3], 'only the latest target is sent');
  assert.equal(Tether.cart.lines[0]?.quantity, 3);
  assert.ok(!find('[tether-cart-lines] > *').classList.contains('is-busy'));
});

test('cart: a quantity field left empty or without a number gets the quantity back, a number is sent', async () => {
  await seedCart(cartFrom([{ merchandiseId: firstVariantId, quantity: 2 }]));
  document.body.innerHTML = `<div tether-cart-lines><div><input tether-line="quantity"></div></div>`;
  Tether.cart.render();
  calls.length = 0;
  const input = /** @type {HTMLInputElement} */ (find('[tether-line="quantity"]'));
  for (const typed of ['', 'abc', '2.5']) {
    input.value = typed;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(input.value, '2', `"${typed}" puts the quantity back`);
  }
  assert.equal(calls.length, 0, 'nothing is sent');
  input.value = ' 3 ';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => Tether.cart.lines[0]?.quantity === 3, 'the update to finish');
  assert.deepEqual(
    calls.map((call) => call.op),
    ['Tether_cartLinesUpdate'],
  );
});

test('cart: + + + - while Shopify answers slowly: the count never steps past the target', async () => {
  const realFetch = globalThis.fetch;
  /** @type {number[]} */
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const { query, variables } = graphqlRequest(init);
    if (query.includes('cartLinesUpdate')) {
      const quantity = numberAt(recordsAt(variables, 'lines')[0], 'quantity');
      sent.push(quantity);
      await new Promise((resolve) => setTimeout(resolve, 30)); // a slow network, so clicks overlap
      const cart = cartFrom([{ merchandiseId: firstVariantId, quantity }]);
      return jsonResponse({ data: { cartLinesUpdate: { cart, userErrors: [], warnings: [] } } });
    }
    return realFetch(url, init);
  };
  try {
    await seedCart(cartFrom([{ merchandiseId: firstVariantId, quantity: 1 }]));
    document.body.innerHTML =
      '<span tether-cart-count></span><div tether-cart-lines><div><span tether-line="quantity"></span><button tether-line-plus>+</button><button tether-line-minus>-</button></div></div>';
    Tether.cart.render();
    /** @type {(number | undefined)[]} */
    const counts = [];
    const off = Tether.cart.subscribe((cart) => counts.push(cart?.totalQuantity));
    const plus = find('[tether-line-plus]');
    plus.click();
    await waitFor(() => sent.length === 1, 'the first update to be sent');
    plus.click();
    plus.click();
    find('[tether-line-minus]').click();
    assert.equal(find('[tether-line="quantity"]').textContent, '3');
    await waitFor(
      () => sent.length === 2 && !find('[tether-cart-lines] > *').classList.contains('is-busy'),
      'the latest update to finish',
    );
    off();
    assert.deepEqual(sent, [2, 3], 'the first, then only the latest');
    assert.equal(find('[tether-cart-count]').textContent, '3');
    assert.ok(
      counts.every((count) => count !== undefined && count <= 3),
      `counts seen: ${counts.join(', ')}`,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('cart.open() works without a tether-cart-drawer (framework carts), subscribe reports it', async () => {
  document.body.innerHTML = '';
  /** @type {boolean | null} */
  let open = null;
  const off = Tether.cart.subscribe((_cart, meta) => {
    open = meta.open;
  });
  Tether.cart.open();
  assert.equal(Tether.cart.isOpen(), true);
  assert.equal(open, true);
  Tether.cart.close();
  assert.equal(open, false);
  off();
});

test('options: a value no variant has is ignored; an impossible combination keeps the most choices', async () => {
  const two = structuredClone(product);
  two.options = [
    {
      name: 'Size',
      optionValues: [
        { name: '250g', swatch: null },
        { name: '1kg', swatch: null },
      ],
    },
    {
      name: 'Roast',
      optionValues: [
        { name: 'Light', swatch: null },
        { name: 'Dark', swatch: null },
        { name: 'Ember', swatch: null },
      ],
    },
  ];
  /**
   * @param {number} i
   * @param {string} size
   * @param {string} roast
   */
  const variantOf = (i, size, roast) => ({
    ...firstVariant,
    id: `gid://shopify/ProductVariant/9${i}`,
    availableForSale: true,
    selectedOptions: [
      { name: 'Size', value: size },
      { name: 'Roast', value: roast },
    ],
  });
  two.variants.nodes = [variantOf(1, '250g', 'Light'), variantOf(2, '1kg', 'Light'), variantOf(3, '1kg', 'Dark')];
  Tether.clearProductCache();
  Tether.primeProduct(two);
  document.body.innerHTML = '<div tether-product="coffee-box"></div>';
  Tether.mount(document);
  await rendered();
  const scope = productScope();
  scope.select('Size', '1kg');
  assert.equal(scope.variant?.id, 'gid://shopify/ProductVariant/92');
  scope.select('Roast', 'Ember'); // no variant at all
  assert.equal(scope.variant.id, 'gid://shopify/ProductVariant/92', 'choice kept');
  scope.select('Size', '250g');
  scope.select('Roast', 'Dark'); // 250g/Dark doesn't exist -> 1kg/Dark
  assert.deepEqual(scope.selected, { Size: '1kg', Roast: 'Dark' });
});

test('variantUrl: the choice goes into ?variant= after a change (not on first render)', async () => {
  await Tether.init({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    country: 'NL',
    locale: 'nl-NL',
    variantUrl: true,
  });
  window.history.replaceState(null, '', '/products/coffee-box');
  Tether.clearProductCache();
  Tether.primeProduct(product);
  document.body.innerHTML = '<div tether-product="coffee-box"></div>';
  Tether.mount(document);
  await rendered();
  // The first render's tether:variant-changed has the extras listener load its part: once a later load of the part has
  // settled, and the microtasks after it have run, the listener has handled that event.
  await import('../src/extras.ts');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.location.search, '', 'nothing on first render');
  productScope().select('Size', '1kg');
  await waitFor(() => /variant=\d+/.test(window.location.search), 'the extras part to write the URL');
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', locale: 'nl-NL' });
  window.history.replaceState(null, '', '/');
});

test('tether-show="list-empty" with a hidden attribute is shown for an empty list', async () => {
  document.body.innerHTML =
    '<div tether-products="nothing-matches"><div tether-list><div></div></div><p id="e" tether-show="list-empty" hidden>None</p></div>';
  Tether.mount(document);
  await waitFor(() => window.getComputedStyle(find('#e')).display !== 'none', 'list-empty to show');
});

test('initialState has has-savings, plenty-in-stock, a plain unavailable map, and honours lowStock', () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', lowStock: 2 });
  const inStock = structuredClone(product);
  inStock.variants.nodes.forEach((variant) => {
    variant.quantityAvailable = 3;
  });
  const state = shop.initialState(inStock);
  assert.equal(typeof state.show['has-savings'], 'boolean');
  assert.equal(state.show['low-stock'], false, '3 > lowStock 2');
  assert.equal(state.show['plenty-in-stock'], true);
  assert.ok(Array.isArray(state.unavailable['Size']));
  assert.doesNotThrow(() => JSON.stringify(state.unavailable));
});

test('hydrate({ card: true }) is smaller and still renders a card without a request', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL', locale: 'nl-NL' });
  const full = shop.hydrate(product);
  const card = shop.hydrate(product, { card: true });
  assert.ok(card.length < full.length);
  document.body.innerHTML = `${card}<div tether-product="coffee-box"><span id="p" tether-bind="price"></span></div>`;
  Tether.mount(document);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(find('[tether-product]').getAttribute('tether-state'), 'ready');
  assert.match(find('#p').textContent, /30/);
  // Cards keep a hover image (image:2), more on request.
  const many = {
    ...product,
    images: {
      nodes: ['a', 'b', 'c', 'd'].map((name) => ({
        url: `https://cdn.shopify.com/${name}.jpg`,
        altText: null,
        width: 10,
        height: 10,
      })),
    },
  };
  /** @param {string} tag */
  const imageCount = (tag) =>
    listAt(
      recordAt(recordsAt(parseJson(tag.replace(/^<script[^>]*>|<\/script>$/g, '')), 'products')[0], 'images'),
      'nodes',
    ).length;
  assert.equal(imageCount(shop.hydrate(many, { card: true })), 2);
  assert.equal(imageCount(shop.hydrate(many, { card: true, images: 3 })), 3);
  assert.equal(imageCount(shop.hydrate(many)), 4);
});

test('queries carry a maxAge bucket (Shopify caches identical query texts); mutations and maxAge: 0 do not', async () => {
  /** @type {string[]} */
  const bodies = [];
  /** @type {typeof globalThis.fetch} */
  const fetch = async (_url, init) => {
    bodies.push(graphqlRequest(init).query);
    return jsonResponse({ data: { product: null } });
  };
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', fetch });
  await shop.getProduct('x');
  assert.match(bodies[0] ?? '', / #\d+$/);
  const none = server.createStorefront({ domain: 'shop.test', token: 't', maxAge: 0, fetch });
  await none.getProduct('x');
  assert.doesNotMatch(bodies[1] ?? '', /#\d+$/);
  await none.query('mutation M { a }');
  assert.doesNotMatch(bodies[2] ?? '', /#\d+$/);
});

test('jsonLd: Product / ProductGroup with offers per variant, safe to put in HTML', () => {
  const shop = server.createStorefront({
    domain: 'shop.test',
    token: 't',
    siteUrl: 'https://shop.example',
    productPath: '/products',
  });
  const data = shop.jsonLdData(product);
  assert.ok(data);
  assert.ok(['Product', 'ProductGroup'].includes(String(data['@type'])));
  const offers = data['offers']
    ? [data['offers']]
    : [data['hasVariant']].flat().map((variant) => fieldOf(variant, 'offers'));
  assert.ok(
    offers.every(
      (offer) =>
        fieldOf(offer, 'price') &&
        fieldOf(offer, 'priceCurrency') &&
        /schema.org\/(InStock|OutOfStock|BackOrder)/.test(String(fieldOf(offer, 'availability'))),
    ),
  );
  assert.match(String(data['url']), /^https:\/\/shop\.example\/products\/coffee-box$/);
  const evil = { ...product, title: '</script><script>alert(1)</script>' };
  assert.ok(!shop.jsonLd(evil).slice(30, -9).includes('</script><script>'), 'escaped');
});

test('search as you type: results while typing, arrow keys, Escape, stale answers ignored', async () => {
  document.body.innerHTML = `<form tether-search action="/search">
    <input tether-search-input name="q">
    <div tether-search-results>
      <div tether-search-products><a><span tether-search-bind="title"></span> <span tether-search-bind="price"></span></a></div>
      <div tether-search-queries><a><span tether-search-bind="text"></span></a></div>
      <p tether-show="search-empty" hidden>Nothing</p>
    </div></form>`;
  Tether.mount(document);
  const input = find('[tether-search-input]');
  await waitFor(() => input.getAttribute('role') === 'combobox', 'the search part to load');
  assert.ok(input instanceof window.HTMLInputElement);
  /** @param {string} text */
  const type = (text) => {
    input.value = text;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  type('c');
  type('co');
  type('cof');
  const root = find('[tether-search]');
  await waitFor(() => root.getAttribute('tether-search-state') === 'ready', 'the results');
  assert.equal(calls.filter((call) => call.op === 'TetherPredictive').length, 1, 'debounced: one request');
  const link = find('[tether-search-products] a');
  assert.equal(find('[tether-search-bind="title"]', link).textContent, product.title);
  assert.match(link.getAttribute('href') ?? '', /coffee-box/);
  assert.match(find('[tether-search-queries] a').getAttribute('href') ?? '', /\/search\?q=coffee%20beans/);
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  assert.equal(input.getAttribute('aria-activedescendant'), link.id);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  type('zzz');
  await waitFor(() => root.getAttribute('tether-search-state') === 'empty', 'no results');
  assert.notEqual(window.getComputedStyle(find('[tether-show="search-empty"]')).display, 'none');
});

test('a page built for another market: html.tether-market-pending until the live prices are in', async () => {
  const de = server.createStorefront({ domain: 'shop.test', token: 't', country: 'DE' });
  document.documentElement.classList.remove('tether-market-pending');
  document.body.innerHTML = `${de.hydrate(product)}<div tether-product="coffee-box"><span tether-bind="price">built price</span></div>`;
  Tether.mount(document);
  assert.ok(document.documentElement.classList.contains('tether-market-pending'));
  await waitFor(
    () => !document.documentElement.classList.contains('tether-market-pending'),
    'the live prices for this market',
  );
});
