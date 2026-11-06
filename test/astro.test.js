// Server module, hydration, Astro View Transitions, cart.subscribe, the Astro integration.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  captureTetherWarnings,
  cartFrom,
  find,
  findAll,
  graphqlRequest,
  jsonResponse,
  linesAt,
  operationName,
  product,
} from './fixtures.js';
import { numberAt, recordAt, recordsAt, stringAt, waitFor } from '../server/test/mocks.js';

// The failures these tests cause on purpose are checked through onError, states and events, not the console.
captureTetherWarnings();

const [firstVariant] = product.variants.nodes;
assert.ok(firstVariant);
const firstVariantId = firstVariant.id;

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://astro.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window['Option'],
  getComputedStyle: dom.window.getComputedStyle,
});

/** @typedef {import('../src/cart/store.ts').ShopifyCart} ShopifyCart */
/** @typedef {import('../src/fragments.ts').Product} Product */
/** @typedef {Parameters<Parameters<typeof import('../src/cart/store.ts').subscribe>[0]>[1]} CartMeta */

/** @type {(ReturnType<typeof graphqlRequest> & { op: string })[]} */
const calls = [];
/**
 * The cart "Shopify" has for the saved id: `seedCart` sets it.
 *
 * @type {ShopifyCart | null}
 */
let savedCart = null;
let livePrice = '30'; // what "Shopify" returns now (the server-rendered copy may be older)
/**
 * @param {Product} sent
 * @param {string} amount
 * @returns {Product}
 */
const withPrice = (sent, amount) => JSON.parse(JSON.stringify(sent).replace(/"amount":"30"/g, `"amount":"${amount}"`));
/** @type {typeof globalThis.fetch} */
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  const op = operationName(query);
  calls.push({ op, query, variables });
  /** @param {unknown} data */
  const ok = (data) => jsonResponse({ data });
  if (op === 'TetherProducts') {
    /** @type {Record<string, Product | null>} */
    const data = {};
    Object.keys(variables).forEach((key) => {
      if (key.startsWith('h')) data[key] = variables[key] === product.handle ? withPrice(product, livePrice) : null;
    });
    return ok(data);
  }
  if (op === 'TetherServerProduct')
    return ok({ product: variables['handle'] === product.handle ? withPrice(product, livePrice) : null });
  if (op === 'TetherServerProductById') return ok({ node: variables['id'] === product.id ? product : null });
  if (op === 'TetherServerProducts') {
    const all = Array.from({ length: 5 }, (_, i) => ({
      ...product,
      id: `gid://shopify/Product/${i + 1}`,
      handle: `p-${i + 1}`,
    }));
    const start = variables['after'] ? Number(variables['after']) : 0;
    const page = all.slice(start, start + numberAt(variables, 'first'));
    return ok({
      products: {
        nodes: page,
        pageInfo: { hasNextPage: start + page.length < all.length, endCursor: String(start + page.length) },
      },
    });
  }
  if (op === 'TetherPredictive')
    return ok({
      predictiveSearch: {
        products: stringAt(variables, 'q').startsWith('cof')
          ? [
              {
                id: product.id,
                handle: product.handle,
                title: product.title,
                availableForSale: true,
                featuredImage: null,
                priceRange: product.priceRange,
              },
            ]
          : [],
        collections: [],
        queries: stringAt(variables, 'q').startsWith('cof') ? [{ text: 'coffee beans' }] : [],
      },
    });
  if (op === 'TetherSearch') return ok({ products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
  if (op === 'TetherCart') return ok({ cart: variables['id'] === savedCart?.id ? savedCart : null });
  if (op === 'Tether_cartCreate')
    return ok({ cartCreate: { cart: cartFrom(linesAt(recordAt(variables, 'input'), 'lines')), userErrors: [] } });
  if (op === 'Tether_cartLinesAdd')
    return ok({
      cartLinesAdd: {
        cart: cartFrom([...linesAt(variables, 'lines'), ...linesAt(variables, 'lines')]),
        userErrors: [],
      },
    });
  if (op === 'Tether_cartLinesUpdate') {
    await new Promise((resolve) => setTimeout(resolve, 30)); // a slow network, so clicks overlap
    const [update] = recordsAt(variables, 'lines');
    assert.ok(update);
    const cart = cartFrom([{ merchandiseId: firstVariantId, quantity: numberAt(update, 'quantity') }]);
    const [line] = cart.lines.nodes;
    assert.ok(line);
    line.id = stringAt(update, 'id');
    return ok({ cartLinesUpdate: { cart, userErrors: [] } });
  }
  throw new Error(`unexpected ${op}`);
};

/**
 * Starts the page with `cart` saved, as a visitor coming back to it.
 *
 * @param {ShopifyCart} cart
 */
async function seedCart(cart) {
  savedCart = cart;
  window.localStorage.setItem(cfg.storageKey, cart.id);
  await Tether.cart.init();
}

/** For a check that nothing more happens: a request that shouldn't go out leaves no condition to wait for. */
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits until the first `selector` on the page has rendered. */
const rendered = (selector = '[tether-product]') =>
  waitFor(() => document.querySelector(selector)?.getAttribute('tether-state') === 'ready', `${selector} to render`);
/** The scope of the first product on the page, which the test has rendered. */
function productScope() {
  const scope = Tether.getScope(document.querySelector('[tether-product]'));
  assert.ok(scope, 'a rendered product');
  return scope;
}
/**
 * @param {unknown} value
 * @param {string} name
 * @returns {unknown} The field `name` of `value`, `undefined` when `value` isn't an object.
 */
function fieldOf(value, name) {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}
/** @type {typeof import('../src/index.ts').default} */
let Tether;
/** @type {typeof import('../src/server.ts')} */
let server;
/**
 * The live config: `Tether.config` is a read-only view of it.
 *
 * @type {import('../src/config.ts').TetherConfig}
 */
let cfg;

before(async () => {
  ({ default: Tether } = await import('../src/index.ts'));
  ({ cfg } = await import('../src/config.ts'));
  server = await import('../src/server.ts');
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', locale: 'nl-NL' });
});
beforeEach(() => {
  calls.length = 0;
  livePrice = '30';
  Tether.clearProductCache();
});

// ---- server module ---------------------------------------------------------

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
  assert.equal((tag.match(/<\/script>/g) || []).length, 1, 'only the real closing tag');
  const json = JSON.parse(tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
  assert.equal(json.country, 'NL');
  assert.equal(json.products[0].title, evil.title);
});

// ---- hydration in the browser ----------------------------------------------

/** @param {string} tag */
const page = (tag) => `${tag}
  <div tether-product="coffee-box"><h1 tether-bind="title">Coffee Box</h1><span id="price" tether-bind="price">€ 30,00</span></div>`;

test('hydration: server-rendered product renders with no request, then one background refresh updates it', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  livePrice = '30';
  const serverCopy = await shop.getProduct('coffee-box');
  calls.length = 0;
  livePrice = '25'; // the price changed after the build
  document.body.innerHTML = page(shop.hydrate(serverCopy));
  Tether.mount(document);
  await Promise.resolve();
  await Promise.resolve();
  const root = find('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'ready', 'rendered from the server data, no loading state');
  assert.match(find('#price').textContent, /30/);
  await waitFor(() => /25/.test(find('#price').textContent ?? ''), 'the background refresh');
  assert.equal(calls.filter((call) => call.op === 'TetherProducts').length, 1, 'exactly one background refresh');
  assert.match(find('#price').textContent, /25/, 'live price after the refresh');
});

test('hydration: the next page of a View Transition visit keeps the copy loaded a moment ago', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  livePrice = '30';
  const old = await shop.getProduct('coffee-box'); // built earlier, now outdated
  livePrice = '22';
  calls.length = 0;
  // page 1 refreshed the product a moment ago (the test above, or here: a fresh mount)
  document.body.innerHTML = page(shop.hydrate(old));
  Tether.mount(document);
  await waitFor(() => /22/.test(find('#price').textContent ?? ''), "page 1's refresh");
  const before = calls.filter((call) => call.op === 'TetherProducts').length;
  // page 2 carries the same stale build data
  Tether.unmount();
  document.body.innerHTML = page(shop.hydrate(old));
  Tether.mount(document);
  await settle();
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
  await settle();
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
  await settle();
  assert.equal(calls.length, 0);
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', locale: 'nl-NL' });
});

// ---- Astro View Transitions, islands ----------------------------------------

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

// ---- the Astro integration ---------------------------------------------------

test('integration: injects the page script with .env values, drops functions with a warning', async () => {
  const { default: tether } = await import('../src/astro.ts');
  const prev = { ...process.env };
  process.env['PUBLIC_SHOPIFY_DOMAIN'] = 'env-shop.myshopify.com';
  process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'] = 'env-token';
  /** @type {{ stage: string, code: string }[]} */
  const scripts = [];
  /** @type {string[]} */
  const warnings = [];
  // @ts-expect-error -- a function can't reach the page: the integration drops it with a warning
  await tether({ country: 'NL', onError: () => {} }).hooks['astro:config:setup']({
    injectScript: (stage, code) => scripts.push({ stage, code }),
    command: 'build',
    config: { root: pathToFileURL(join(tmpdir(), 'astro-site/')) },
    logger: { warn: (message) => warnings.push(message) },
  });
  process.env = prev;
  assert.deepEqual(
    scripts.map((script) => script.stage),
    ['head-inline', 'page'],
  );
  const [inline, pageScript] = scripts;
  assert.ok(inline && pageScript);
  assert.match(inline.code, /TETHER_INTEGRATION/, 'no second auto-start from window.TETHER_CONFIG');
  const page = pageScript.code;
  assert.match(page, /import Tether from '@occluze\/tether'/);
  assert.match(page, /"domain":"env-shop\.myshopify\.com"/);
  assert.match(page, /"country":"NL"/);
  assert.ok(!/onError/.test(page));
  assert.match(warnings.join(' '), /onError: functions can't be passed here/);
});

test('integration: warns clearly when the store is missing', async () => {
  const { default: tether } = await import('../src/astro.ts');
  const prev = { ...process.env };
  delete process.env['PUBLIC_SHOPIFY_DOMAIN'];
  delete process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'];
  /** @type {string[]} */
  const warnings = [];
  await tether().hooks['astro:config:setup']({
    injectScript() {},
    command: 'dev',
    config: { root: pathToFileURL(join(tmpdir(), 'none/')) },
    logger: { warn: (message) => warnings.push(message) },
  });
  process.env = prev;
  assert.match(warnings.join(' '), /PUBLIC_SHOPIFY_DOMAIN and PUBLIC_SHOPIFY_STOREFRONT_TOKEN/);
});

test('integration: reads .env, .env.local and .env.production like Vite (process.env wins)', async () => {
  const { default: tether } = await import('../src/astro.ts');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'astro env '));
  await writeFile(
    join(dir, '.env'),
    '# comment\nPUBLIC_SHOPIFY_DOMAIN=from-env.myshopify.com\nPUBLIC_SHOPIFY_STOREFRONT_TOKEN="quoted-token" # note\n',
  );
  await writeFile(join(dir, '.env.production'), 'PUBLIC_SHOPIFY_DOMAIN=prod.myshopify.com\n');
  const prev = { ...process.env };
  delete process.env['PUBLIC_SHOPIFY_DOMAIN'];
  delete process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'];
  /** @type {string[]} */
  const scripts = [];
  await tether().hooks['astro:config:setup']({
    injectScript: (_stage, code) => scripts.push(code),
    command: 'build',
    config: { root: pathToFileURL(`${dir}/`) },
    logger: { warn() {} },
  });
  process.env = prev;
  const pageScript = scripts[1];
  assert.ok(pageScript);
  assert.match(pageScript, /"domain":"prod\.myshopify\.com"/, '.env.production wins over .env');
  assert.match(pageScript, /"token":"quoted-token"/);
});

test('integration: --mode picks the .env file; shop.config.js changes restart the dev server', async () => {
  const { default: tether } = await import('../src/astro.ts');
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'astro-mode-'));
  await writeFile(
    join(dir, '.env.staging'),
    'PUBLIC_SHOPIFY_DOMAIN=staging.myshopify.com\nPUBLIC_SHOPIFY_STOREFRONT_TOKEN=s\n',
  );
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'shop.config.js'), 'export default {};\n');
  const prev = { ...process.env };
  const argv = process.argv;
  delete process.env['PUBLIC_SHOPIFY_DOMAIN'];
  delete process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'];
  process.argv = [...argv, '--mode', 'staging'];
  /** @type {string[]} */
  const scripts = [];
  /** @type {string[]} */
  const watched = [];
  try {
    await tether().hooks['astro:config:setup']({
      injectScript: (_stage, code) => scripts.push(code),
      command: 'dev',
      addWatchFile: (file) => watched.push(String(file)),
      config: { root: pathToFileURL(`${dir}/`) },
      logger: { warn() {} },
    });
  } finally {
    process.env = prev;
    process.argv = argv;
  }
  assert.match(scripts[1] ?? '', /"domain":"staging\.myshopify\.com"/);
  assert.deepEqual(watched, [join(dir, 'src', 'shop.config.js')]);
});

// ---- reported by first-time users -------------------------------------------

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
  assert.ok(seen.length >= 3, `called now, on the event and after load: ${seen}`);
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
      const key = /cartCreate/.test(query) ? 'cartCreate' : 'cartLinesAdd';
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
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'DE', language: 'DE' });
  /** @type {Product} */
  const de = JSON.parse(
    JSON.stringify(product)
      .replace(/"Size"/g, '"Größe"')
      .replace(/"1kg"/g, '"1 kg"'),
  );
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
  void shop;
});

// ---- reported by the 10 store builders / shoppers ---------------------------

test('cart: quick +/+ clicks add up (each builds on the last one asked for), the line is busy meanwhile', async () => {
  const cart = cartFrom([{ merchandiseId: firstVariantId, quantity: 1 }]);
  await seedCart(cart);
  const lineId = cart.lines.nodes[0]?.id;
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
  void lineId;
});

test('cart: + + + - while Shopify answers slowly: the count never steps past the target', async () => {
  const realFetch = globalThis.fetch;
  /** @type {number[]} */
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const { query, variables } = graphqlRequest(init);
    if (/cartLinesUpdate/.test(query)) {
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
      `counts seen: ${counts}`,
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
  assert.equal(scope.variant?.id, 'gid://shopify/ProductVariant/92', 'choice kept');
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
  await settle(); // time for the extras part to write a URL, which it must not
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
    JSON.parse(tag.replace(/^<script[^>]*>|<\/script>$/g, '')).products[0].images.nodes.length;
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
  await none.query('mutation M { a }').catch(() => {});
  assert.doesNotMatch(bodies[2] || '', /#\d+$/);
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
  assert.ok(!/<\/script><script>/.test(shop.jsonLd(evil).slice(30, -9)), 'escaped');
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

// ---- analytics, customer accounts -------------------------------------------

test("analytics: Tether's own events become GA4 dataLayer events (view_item, add_to_cart from cart changes, begin_checkout); look-alikes send nothing", async () => {
  /**
   * What the analytics part pushes for GA4.
   *
   * @type {{ event?: string, ecommerce?: { items: { quantity: number }[], value: unknown } | null }[]}
   */
  const dataLayer = [];
  Object.assign(window, { dataLayer });
  const analytics = await import('../src/analytics.ts');
  const prev = cfg.analytics;
  cfg.analytics = { dataLayer: true };
  /** @type {Event[]} */
  const queue = [];
  await analytics.startAnalytics(queue);
  Tether.clearProductCache();
  Tether.primeProduct(product);
  document.body.innerHTML = '<div tether-product="coffee-box"></div>';
  Tether.mount(document);
  await rendered();
  const root = find('[tether-product]');
  const { ownEvent } = await import('../src/dom.ts');
  // Look-alike events from another script, whatever their detail, send nothing and don't throw.
  queue.push(new window.CustomEvent('tether:cart-updated', { detail: null }));
  queue.push(new window.CustomEvent('tether:checkout', { detail: { cart: cartFrom([]) } }));
  const scope = Tether.getScope(root);
  assert.ok(scope);
  queue.push(ownEvent('product-ready', { product, scope }));
  /** @param {number} quantity */
  const line = (quantity) => cartFrom([{ merchandiseId: firstVariantId, quantity }]);
  queue.push(ownEvent('cart-updated', { cart: line(1), reason: 'load' }));
  queue.push(ownEvent('cart-updated', { cart: line(3), reason: 'add' }));
  queue.push(ownEvent('checkout', { cart: line(3), url: 'https://shop.test/checkout/abc' }));
  const events = dataLayer.filter((entry) => entry.event).map((entry) => entry.event);
  assert.deepEqual(events, ['view_item', 'add_to_cart', 'begin_checkout']);
  const add = dataLayer.find((entry) => entry.event === 'add_to_cart');
  assert.equal(add?.ecommerce?.items[0]?.quantity, 2, 'the difference');
  assert.equal(typeof add?.ecommerce?.value, 'number');
  assert.ok(
    dataLayer.some((entry) => entry.ecommerce === null),
    'cleared before each push',
  );
  cfg.analytics = prev;
});

test('customer accounts: no token in the browser, the Worker does the work', async () => {
  const account = await import('../src/account.ts');
  /** @type {string[]} */
  const nav = [];
  cfg.account = { server: '/_tether/account', navigate: (url) => nav.push(url) }; // a path on this site works too
  const realFetch = globalThis.fetch;
  const asked = [];
  let noOrders = false;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.startsWith('https://astro.test/_tether/account')) {
      asked.push({ path: new URL(target).pathname.split('/').pop(), init });
      assert.equal(init.credentials, 'include');
      /** @param {unknown} data */
      const json = (data) => jsonResponse(data);
      if (target.endsWith('/me')) return json({ loggedIn: true, customer: { firstName: 'Ada', email: 'ada@x.test' } });
      if (target.includes('/orders'))
        return json({
          orders: noOrders
            ? []
            : [
                {
                  id: 'o1',
                  name: '#1001',
                  processedAt: '2026-11-01',
                  statusPageUrl: 'https://x/o1',
                  totalPrice: { amount: '10', currencyCode: 'EUR' },
                  lineItems: {
                    nodes: [
                      {
                        title: 'Tee',
                        variantTitle: 'M',
                        quantity: 2,
                        image: { url: 'https://cdn.shopify.com/tee.jpg', altText: null },
                      },
                    ],
                  },
                },
              ],
        });
      if (target.endsWith('/cart')) {
        assert.equal(new Headers(init.headers).get('X-Tether-Account'), '1');
        return json({ linked: true, checkoutUrl: 'https://shop.test/checkouts/c/1' });
      }
      if (target.endsWith('/logout')) return json({ logoutUrl: 'https://shopify.com/logout?x' });
    }
    return realFetch(url, init);
  };
  try {
    await seedCart(cartFrom([{ merchandiseId: firstVariantId, quantity: 1 }]));
    await account.login();
    const loginUrl = nav.pop();
    assert.ok(loginUrl);
    const to = new URL(loginUrl);
    assert.equal(to.pathname, '/_tether/account/login');
    assert.equal(to.searchParams.get('cart'), null, 'no cart on the login link (linked through POST /cart)');
    window.history.replaceState(null, '', '/account?account=in');
    document.body.innerHTML = `<span id="n" tether-account-bind="first-name"></span>
      <ul tether-orders><li><span tether-order-bind="name"></span><img id="oi" tether-order-bind="image">
        <div tether-order-lines><p><span tether-order-line="quantity"></span>x <span tether-order-line="title"></span> <span tether-order-line="variant-title"></span></p></div></li></ul>
      <p id="ol" tether-show="orders-loading"></p><p id="oe" tether-show="orders-empty"></p>`;
    await account.mountAccount(document);
    /** @param {string} id */
    const visible = (id) => window.getComputedStyle(find(`#${id}`)).display !== 'none';
    assert.match(find('#oi').getAttribute('src') ?? '', /tee\.jpg/);
    assert.equal(find('[tether-order-lines] p').textContent.replace(/\s+/g, ' ').trim(), '2x Tee M');
    assert.ok(!visible('ol') && !visible('oe'));
    assert.equal(find('[tether-order-bind="name"]').textContent, '#1001');
    noOrders = true;
    await account.render(document);
    assert.ok(visible('oe'), 'no orders yet');
    noOrders = false;
    assert.equal(window.location.search, '', '?account=in removed');
    assert.equal(find('#n').textContent, 'Ada');
    const url = await Tether.cart.checkout('_self');
    assert.equal(url, 'https://shop.test/checkouts/c/1?logged_in=true', "the Worker's checkout, logged in");
    const stored = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    assert.ok(
      !/access|refresh|token/i.test(stored.replace(/account-hint/g, '')),
      'nothing secret stored in the browser',
    );
    await account.logout();
    assert.match(nav.pop() ?? '', /shopify\.com\/logout/);
  } finally {
    globalThis.fetch = realFetch;
    cfg.account = null;
    Tether.cart.setCheckoutResolver(null);
    window.history.replaceState(null, '', '/');
  }
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

test('image size attributes: max-width, or valid HTML tether-max-width / data-max-width', async () => {
  const { cdnUrl } = await import('../src/dom.ts');
  /** @param {Record<string, string>} attributes */
  const img = (attributes) => {
    const element = document.createElement('img');
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
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

test('account pages: order page with returns, subscriptions with actions, addresses, profile', async () => {
  // A fresh instance, as an earlier test logged out; tsc can't resolve the query string, so the annotation types it.
  const freshAccount = '../src/account.ts?pages';
  /** @type {typeof import('../src/account.ts')} */
  const account = await import(freshAccount);
  cfg.account = {
    server: '/_tether/account',
    orderUrl: '/account/order?id={id}',
    subscriptionsUrl: 'https://shopify.com/1/account/pages/subs',
  };
  const realFetch = globalThis.fetch;
  /** @type {{ path: string, body: unknown }[]} */
  const posts = [];
  let status = 'ACTIVE';
  /** @param {string} amount */
  const money = (amount) => ({ amount, currencyCode: 'EUR' });
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url), 'https://astro.test');
    if (!target.pathname.startsWith('/_tether/account')) return realFetch(url, init);
    const path = target.pathname.slice('/_tether/account'.length);
    /** @param {unknown} data */
    const ok = (data) => jsonResponse(data);
    if (init.method === 'POST') {
      assert.equal(new Headers(init.headers).get('X-Tether-Account'), '1');
      posts.push({ path, body: graphqlRequest(init) });
    }
    if (path === '/me')
      return ok({ loggedIn: true, customer: { firstName: 'Ada', lastName: 'L', email: 'ada@x.test' } });
    if (path === '/orders')
      return ok({
        orders: [{ id: 'gid://shopify/Order/7', name: '#1007', totalPrice: money('10'), lineItems: { nodes: [] } }],
      });
    if (path === '/order')
      return ok({
        ok: true,
        order: {
          id: 'gid://shopify/Order/7',
          name: '#1007',
          processedAt: '2026-11-01',
          totalPrice: money('10'),
          subtotal: money('8'),
          totalShipping: money('2'),
          financialStatus: 'PAID',
          fulfillmentStatus: 'FULFILLED',
          shippingAddress: { formatted: ['Street 1', 'Utrecht'] },
          lineItems: {
            nodes: [
              {
                id: 'gid://shopify/LineItem/1',
                title: 'Tee',
                quantity: 2,
                price: money('4'),
                suggestedReturnReasonDefinitions: {
                  nodes: [{ id: 'gid://shopify/ReturnReasonDefinition/1', name: 'Too big' }],
                },
              },
            ],
          },
          fulfillments: {
            nodes: [
              {
                status: 'SUCCESS',
                createdAt: '2026-11-02',
                trackingInformation: [{ company: 'PostNL', number: '3S123', url: 'https://track.example/3S123' }],
              },
            ],
          },
          returnInformation: {
            returnableLineItems: { nodes: [{ quantity: 2, lineItem: { id: 'gid://shopify/LineItem/1' } }] },
          },
          returns: { nodes: [] },
        },
      });
    if (path === '/subscriptions')
      return ok({
        ok: true,
        subscriptions: [
          {
            id: 'gid://shopify/SubscriptionContract/5',
            status,
            nextBillingDate: '2026-12-01',
            currencyCode: 'EUR',
            deliveryPolicy: { interval: 'MONTH', intervalCount: { count: 1 } },
            lines: {
              nodes: [{ title: 'Socks', quantity: 1, currentPrice: money('9'), lineDiscountedPrice: money('9') }],
            },
            upcomingBillingCycles: { nodes: [{ cycleIndex: 2, skipped: false }] },
          },
        ],
      });
    if (path === '/subscription') {
      status = 'PAUSED';
      return ok({ ok: true, contract: { status } });
    }
    if (path === '/addresses')
      return ok({
        ok: true,
        addresses: [
          {
            id: 'gid://shopify/CustomerAddress/1',
            city: 'Utrecht',
            formatted: ['Street 1', 'Utrecht'],
            isDefault: true,
          },
        ],
      });
    if (path === '/address')
      return jsonResponse({ error: 'City is required', userErrors: [{ message: 'City is required' }] }, 400);
    if (path === '/return') return ok({ ok: true, return: { id: 'gid://shopify/Return/1', status: 'REQUESTED' } });
    if (path === '/profile') return ok({ ok: true, customer: { firstName: 'Ada' } });
    return ok({});
  };
  try {
    window.history.replaceState(null, '', '/account/order?id=7');
    document.body.innerHTML = `
      <a id="subs" tether-account-link="subscriptions" href="#">Manage</a>
      <ul tether-orders><li><a tether-order-bind="url"><span tether-order-bind="name"></span></a></li></ul>
      <section tether-order="url:id">
        <p tether-order-show="loading">Loading</p>
        <h1 tether-order-bind="name"></h1><span id="ship" tether-order-bind="shipping-address"></span><span id="tot" tether-order-bind="total"></span>
        <div tether-order-lines><div><span tether-order-line="title"></span><span tether-order-line="price"></span>
          <input tether-return-quantity type="number"><select tether-return-reason></select></div></div>
        <div tether-order-fulfillments><p><span tether-fulfillment-bind="company"></span> <a tether-fulfillment-bind="url" tether-fulfillment-bind-text="number"></a></p></div>
        <button id="ret" tether-order-show="returnable" tether-order-return>Return</button>
        <p id="done" tether-order-show="return-requested" hidden>Requested</p>
      </section>
      <p id="sl" tether-show="subscriptions-loading"></p><p id="se" tether-show="subscriptions-empty"></p>
      <div tether-subscriptions><div><span tether-subscription-bind="status"></span> <span tether-subscription-bind="interval"></span>
        <button id="pause" tether-subscription-action="pause">Pause</button><button id="resume" tether-subscription-action="resume">Resume</button>
        <span tether-subscription-show="paused" hidden>Paused</span></div></div>
      <ul tether-addresses><li><span tether-address-bind="formatted"></span><b tether-address-show="default" hidden>Default</b></li></ul>
      <form tether-address-form><input name="address1" value="x"><p tether-form-error></p><button>Save</button></form>
      <form tether-profile-form><input name="firstName"><input name="lastName"></form>`;
    // A router on document that registered first (Astro's ClientRouter) must see the submit handled.
    /** @type {boolean | null} */
    let routerSaw = null;
    /** @param {Event} event */
    const router = (event) => {
      routerSaw = event.defaultPrevented;
    };
    document.addEventListener('submit', router);
    await account.mountAccount(document);
    /** @param {string} selector */
    const visible = (selector) => window.getComputedStyle(find(selector)).display !== 'none';
    /** @param {string} selector */
    const input = (selector) => {
      const element = find(selector);
      assert.ok(element instanceof window.HTMLInputElement, `${selector} is an input`);
      return element;
    };
    /** @param {string} selector */
    const button = (selector) => {
      const element = find(selector);
      assert.ok(element instanceof window.HTMLButtonElement, `${selector} is a button`);
      return element;
    };
    assert.equal(find('#subs').getAttribute('href'), 'https://shopify.com/1/account/pages/subs');
    assert.equal(
      find('[tether-orders] a').getAttribute('href'),
      '/account/order?id=7',
      "list links to the site's own order page",
    );
    assert.equal(find('[tether-order] h1').textContent, '#1007');
    assert.equal(find('#ship').textContent, 'Street 1, Utrecht');
    assert.equal(find('[tether-order-line="title"]').textContent, 'Tee');
    assert.equal(find('[tether-fulfillment-bind="company"]').textContent, 'PostNL');
    assert.equal(find('[tether-fulfillment-bind="url"]').getAttribute('href'), 'https://track.example/3S123');
    assert.equal(input('[tether-return-quantity]').max, '2');
    const reason = find('[tether-return-reason]');
    assert.ok(reason instanceof window.HTMLSelectElement);
    assert.equal(reason.options.length, 1);
    assert.ok(visible('#ret'));
    assert.ok(!visible('[tether-order-show="loading"]'));
    // Subscriptions: rendered, states, actions follow the status.
    assert.equal(find('[tether-subscription-bind="status"]').textContent, 'active');
    assert.equal(find('[tether-subscription-bind="interval"]').textContent, 'month');
    assert.ok(!visible('#sl') && !visible('#se'));
    assert.equal(button('#resume').disabled, true);
    find('#pause').click();
    await waitFor(() => find('[tether-subscription-bind="status"]').textContent === 'paused', 'the pause to finish');
    assert.deepEqual(posts.find((post) => post.path === '/subscription')?.body, {
      id: 'gid://shopify/SubscriptionContract/5',
      action: 'pause',
    });
    assert.equal(find('[tether-subscription-bind="status"]').textContent, 'paused');
    assert.ok(visible('[tether-subscription-show="paused"]'));
    assert.equal(button('#pause').disabled, true);
    // Return request: only lines with a quantity.
    input('[tether-return-quantity]').value = '1';
    find('#ret').click();
    await waitFor(() => visible('#done'), 'the return request to finish');
    assert.deepEqual(posts.find((post) => post.path === '/return')?.body, {
      orderId: 'gid://shopify/Order/7',
      lines: [
        { lineItemId: 'gid://shopify/LineItem/1', quantity: 1, reasonId: 'gid://shopify/ReturnReasonDefinition/1' },
      ],
    });
    assert.ok(visible('#done'));
    // Addresses: list with default; a Shopify error shows in the form.
    assert.equal(find('[tether-address-bind="formatted"]').textContent, 'Street 1, Utrecht');
    assert.ok(visible('[tether-address-show="default"]'));
    find('[tether-address-form]').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
    find('[tether-address-form]').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true })); // Enter twice
    document.removeEventListener('submit', router);
    assert.equal(routerSaw, true, 'account forms are handled in the capture phase, before a router');
    await waitFor(() => find('[tether-address-form]').getAttribute('tether-form-state') === 'error', "Shopify's error");
    assert.equal(find('[tether-address-form] [tether-form-error]').textContent, 'City is required');
    assert.equal(
      posts.filter((post) => post.path === '/address').length,
      1,
      'a second submit while sending sends nothing',
    );
    // Profile form prefilled.
    assert.equal(input('[tether-profile-form] [name="firstName"]').value, 'Ada');
  } finally {
    globalThis.fetch = realFetch;
    cfg.account = null;
    window.history.replaceState(null, '', '/');
  }
});

test('integration: a secret Shopify token is never written into pages, and a non-PUBLIC name is flagged', async () => {
  const { default: tether } = await import('../src/astro.ts');
  const prev = { ...process.env };
  /**
   * @param {string[]} warnings
   * @param {string[]} [scripts]
   */
  const setup = (warnings, scripts = []) =>
    tether().hooks['astro:config:setup']({
      injectScript: (_stage, code) => scripts.push(code),
      command: 'build',
      config: { root: pathToFileURL(join(tmpdir(), 'astro-secret/')) },
      logger: { warn: (message) => warnings.push(message) },
    });
  try {
    delete process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'];
    process.env['PUBLIC_SHOPIFY_DOMAIN'] = 'shop.myshopify.com';
    process.env['SHOPIFY_STOREFRONT_TOKEN'] = 'shpat_0123456789abcdef';
    /** @type {string[]} */
    const scripts = [];
    await assert.rejects(setup([], scripts), /secret token/);
    assert.ok(!scripts.join('').includes('shpat_'), 'nothing was injected');

    process.env['SHOPIFY_STOREFRONT_TOKEN'] = '0123456789abcdef0123456789abcdef';
    /** @type {string[]} */
    const warnings = [];
    await setup(warnings);
    assert.match(warnings.join(' '), /SHOPIFY_STOREFRONT_TOKEN is written into every page/);
  } finally {
    process.env = prev;
  }
});
