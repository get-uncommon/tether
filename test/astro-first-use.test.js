// What first-time users ran into: shown elements, cart warnings, translated options and more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tether, calls, firstVariantId, productScope, rendered, server } from './astro-harness.js';
import { cartFrom, find, findAll, graphqlRequest, jsonResponse, linesAt, product } from './fixtures.js';
import { parseJson, recordAt, waitFor } from '../server/test/mocks.js';
import { isProductShape } from '../src/product-shape.ts';

/** @typedef {Parameters<Parameters<typeof import('../src/cart/store.ts').subscribe>[0]>[1]} CartMeta */
/** @typedef {import('../src/fragments.ts').Product} Product */

test('tether-show: elements hidden before the script ran (class, inline style, hidden) are shown when true', async () => {
  document.body.innerHTML = `<style>.hide { display: none }</style>
    <div tether-product="coffee-box">
      <span id="a" class="hide" tether-show="in-stock">A</span>
      <span id="b" style="display:none" tether-show="in-stock">B</span>
      <span id="c" hidden tether-show="in-stock">C</span>
      <span id="e" class="hide" tether-show="in-stock" tether-display="inline-flex">E</span>
      <span id="d" class="hide" tether-show="out-of-stock">D</span>
    </div>`;
  Tether.mount(document);
  await rendered();
  /** @param {string} id */
  const visible = (id) => window.getComputedStyle(find(`#${id}`)).display !== 'none';
  assert.ok(visible('a'), 'class-hidden shown');
  assert.ok(visible('b'), 'inline display:none shown');
  assert.ok(visible('c'), 'hidden attribute shown');
  assert.equal(find('#e').style.display, 'inline-flex', 'tether-display when CSS hides it');
  assert.ok(!visible('d'), 'false condition stays hidden');
});

test('cart.subscribe hears the saved cart once it has loaded', async () => {
  /** @type {number[]} */
  const seen = [];
  const off = Tether.cart.subscribe((_cart, { count }) => seen.push(count));
  document.dispatchEvent(new window.CustomEvent('tether:cart-updated', { detail: {} })); // sanity: listener works
  await Tether.cart.init();
  off();
  assert.ok(seen.length >= 3, `called now, on the event and after load: ${seen.join(', ')}`);
});

test('cart: line links keep the chosen variant; checkout is marked disabled while the cart is empty', async () => {
  document.body.innerHTML = `<button id="co" tether-checkout>Checkout</button>
    <div tether-cart-lines><div><a tether-line="url">x</a></div></div>`;
  Tether.cart.forgetSaved();
  assert.equal(find('#co').getAttribute('aria-disabled'), 'true');
  const cart = await Tether.cart.add(firstVariantId, 1);
  assert.ok(cart);
  assert.equal(find('#co').getAttribute('aria-disabled'), 'false');
  assert.match(find('[tether-line="url"]').getAttribute('href') ?? '', /\/products?\/coffee-box\?variant=\d+$/);
});

test('server initialState() matches what the browser shows first (variant, price, conditions)', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL', locale: 'nl-NL' });
  const cases = [
    product,
    { ...product, requiresSellingPlan: true }, // must be bought on a plan: plan price first
    {
      ...product,
      sellingPlanGroups: { nodes: [] },
      variants: {
        nodes: product.variants.nodes.map((variant, i) => ({
          ...variant,
          availableForSale: i > 0,
          quantityAvailable: 3,
          sellingPlanAllocations: { nodes: [] },
        })),
      },
    },
  ];
  /** @type {import('../src/product-state.ts').ShowCondition[]} */
  const keys = [
    'in-stock',
    'out-of-stock',
    'low-stock',
    'on-sale',
    'subscription-available',
    'subscription-only',
    'one-time-available',
    'subscription-selected',
    'one-time-selected',
    'has-variants',
  ];
  for (const [index, shown] of cases.entries()) {
    const state = shop.initialState(shown);
    Tether.clearProductCache();
    Tether.primeProduct(shown);
    document.body.innerHTML = `<div tether-product="${shown.handle}"><span id="price" tether-bind="price"></span>
      ${keys.map((key) => `<i data-key="${key}" tether-show="${key}"></i>`).join('')}</div>`;
    Tether.mount(document);
    await rendered();
    assert.equal(
      find('#price').textContent,
      shop.formatMoney(state.price),
      `price (${shown.requiresSellingPlan ? 'plan' : 'one-time'})`,
    );
    for (const key of keys) {
      const element = find(`[data-key="${key}"]`);
      assert.equal(element.style.display !== 'none', state.show[key], `${key} for case ${index}`);
    }
    assert.equal(productScope().variant?.id, state.variant.id);
  }
});

test('cart warnings: less stock than asked is shown, and subscribe reports loaded + warnings', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const { query, variables } = graphqlRequest(init);
    if (/Tether_cartLinesAdd|Tether_cartCreate/.test(query)) {
      assert.match(query, /warnings \{ code message target \}/);
      const lines = variables['lines'] ? linesAt(variables, 'lines') : linesAt(recordAt(variables, 'input'), 'lines');
      const key = query.includes('cartCreate') ? 'cartCreate' : 'cartLinesAdd';
      return jsonResponse({
        data: {
          [key]: {
            cart: cartFrom(lines),
            userErrors: [],
            warnings: [{ code: 'MERCHANDISE_NOT_ENOUGH_STOCK', message: 'Only 1 left' }],
          },
        },
      });
    }
    return realFetch(url, init);
  };
  try {
    document.body.innerHTML = '<p id="w" tether-show="cart-warning" hidden><span tether-cart-warning></span></p>';
    /** @type {CartMeta[]} */
    const metas = [];
    const off = Tether.cart.subscribe((_cart, meta) => metas.push(meta));
    await Tether.cart.add(firstVariantId, 5);
    off();
    const meta = metas.at(-1);
    assert.ok(meta);
    assert.equal(meta.loaded, true);
    assert.equal(meta.warnings[0]?.code, 'MERCHANDISE_NOT_ENOUGH_STOCK');
    assert.notEqual(window.getComputedStyle(find('#w')).display, 'none');
    assert.equal(find('[tether-cart-warning]').textContent, 'Only 1 left');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('another language: translated option names (Size -> Größe) still match the markup by position', async () => {
  const de = parseJson(
    JSON.stringify(product)
      .replace(/"Size"/g, '"Größe"')
      .replace(/"1kg"/g, '"1 kg"'),
  );
  assert.ok(isProductShape(de));
  // The build (NL, English names) put its data in the page; the visitor is in another language.
  document.body.innerHTML = `${server.createStorefront({ domain: 'shop.test', token: 't', country: 'XX' }).hydrate(product)}
    <div tether-product="coffee-box">
      <span id="sel" tether-option-selected="Size"></span>
      <div tether-option-list="Size"><button>250g</button></div>
    </div>`;
  Tether.clearProductCache();
  Tether.primeProduct(de);
  Tether.mount(document);
  await rendered();
  const buttons = findAll('[tether-option-list] [tether-option-value]');
  assert.equal(buttons.length, 2, 'values from the translated product');
  buttons[1]?.click();
  assert.equal(productScope().variant?.selectedOptions[0]?.value, '1 kg');
  assert.equal(find('#sel').textContent, '1 kg');
});

test('image size attributes: max-width, or valid HTML tether-max-width / data-max-width', async () => {
  const { cdnUrl } = await import('../src/dom.ts');
  /** @param {Record<string, string>} attributes */
  const img = (attributes) => {
    const element = document.createElement('img');
    Object.entries(attributes).forEach(([name, value]) => {
      element.setAttribute(name, value);
    });
    return element;
  };
  const url = 'https://cdn.shopify.com/a.jpg';
  assert.match(cdnUrl(url, img({ 'max-width': '400' })), /width=400/);
  assert.match(cdnUrl(url, img({ 'tether-max-width': '500' })), /width=500/);
  assert.match(
    cdnUrl(url, img({ 'data-max-width': '600', 'data-crop': 'center', 'data-max-height': '600' })),
    /width=600/,
  );
});

test('tether-products="url:q": a search results page on a static site', async () => {
  window.history.replaceState(null, '', '/search?q=tee%20shirt');
  calls.length = 0;
  document.body.innerHTML = '<div tether-products="url:q"><div tether-list><div></div></div></div>';
  Tether.mount(document);
  await waitFor(() => calls.some((call) => call.op === 'TetherSearch'), 'the search request');
  const search = calls.find((call) => call.op === 'TetherSearch');
  assert.equal(search?.variables['query'], 'tee shirt');
  window.history.replaceState(null, '', '/');
});
