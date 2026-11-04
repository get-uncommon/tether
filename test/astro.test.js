// Server module, hydration, Astro View Transitions, cart.subscribe, the Astro integration.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { product, cartFrom } from './fixtures.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://astro.test/' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver,
  Option: dom.window.Option, getComputedStyle: dom.window.getComputedStyle,
});

const calls = [];
let livePrice = '30'; // what "Shopify" returns now (the server-rendered copy may be older)
const withPrice = (p, amount) => JSON.parse(JSON.stringify(p).replace(/"amount":"30"/g, `"amount":"${amount}"`));
globalThis.fetch = async (url, init) => {
  const { query, variables } = JSON.parse(init.body);
  const op = query.match(/(?:query|mutation)\s+(\w+)/)[1];
  calls.push({ op, query, variables });
  const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
  if (op === 'TetherProducts') {
    const data = {};
    Object.keys(variables).forEach((k) => { if (k.startsWith('h')) data[k] = variables[k] === product.handle ? withPrice(product, livePrice) : null; });
    return ok(data);
  }
  if (op === 'TetherServerProduct') return ok({ product: variables.handle === product.handle ? withPrice(product, livePrice) : null });
  if (op === 'TetherServerProductById') return ok({ node: variables.id === product.id ? product : null });
  if (op === 'TetherServerProducts') {
    const all = Array.from({ length: 5 }, (_, i) => ({ ...product, id: `gid://shopify/Product/${i + 1}`, handle: `p-${i + 1}` }));
    const start = variables.after ? Number(variables.after) : 0;
    const page = all.slice(start, start + variables.first);
    return ok({ products: { nodes: page, pageInfo: { hasNextPage: start + page.length < all.length, endCursor: String(start + page.length) } } });
  }
  if (op === 'TetherCart') return ok({ cart: null });
  if (op === 'Tether_cartCreate') return ok({ cartCreate: { cart: cartFrom(variables.input.lines), userErrors: [] } });
  if (op === 'Tether_cartLinesAdd') return ok({ cartLinesAdd: { cart: cartFrom([...variables.lines, ...variables.lines]), userErrors: [] } });
  throw new Error(`unexpected ${op}`);
};

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
let Tether;
let server;

before(async () => {
  ({ default: Tether } = await import('../src/index.js'));
  server = await import('../src/server.js');
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', locale: 'nl-NL' });
});
beforeEach(() => { calls.length = 0; livePrice = '30'; Tether.clearProductCache(); });

// ---- server module ---------------------------------------------------------

test('server: createStorefront(import.meta.env) maps the PUBLIC_SHOPIFY_* names and ignores other keys', () => {
  const shop = server.createStorefront({ PUBLIC_SHOPIFY_DOMAIN: 'https://x.myshopify.com/', PUBLIC_SHOPIFY_STOREFRONT_TOKEN: 'tok', MODE: 'production', BASE_URL: '/' });
  assert.equal(shop.config.domain, 'x.myshopify.com');
  assert.equal(shop.config.token, 'tok');
  assert.ok(!('MODE' in shop.config));
  assert.throws(() => server.createStorefront({}), /needs domain and token/);
});

test('server: same product query as the browser, so hydrated data has the same shape', async () => {
  const { productFragment } = await import('../src/fragments.js');
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', fetch: globalThis.fetch });
  await shop.getProduct('coffee-box');
  assert.ok(calls[0].query.includes(productFragment(shop.config)));
  assert.equal(productFragment(shop.config), productFragment(), 'same defaults as the browser config');
});

test('server: getProduct by handle / id / URL, null when missing; allProducts pages through everything', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', pageSize: 2 });
  assert.equal((await shop.getProduct('coffee-box')).title, 'Coffee Box');
  assert.equal((await shop.getProduct('1')).handle, 'coffee-box');
  assert.equal((await shop.getProduct('https://shop.test/products/coffee-box?x=1')).handle, 'coffee-box');
  assert.equal(await shop.getProduct('nope'), null);
  const all = await shop.allProducts();
  assert.deepEqual(all.map((p) => p.handle), ['p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
  assert.equal(calls.filter((c) => c.op === 'TetherServerProducts').length, 3);
});

test('server: formatMoney, productUrl, plans helpers', () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', locale: 'nl-NL', productPath: '/products' });
  assert.match(shop.formatMoney({ amount: '30.0', currencyCode: 'EUR' }), /30,00/);
  assert.equal(shop.productUrl('coffee-box'), '/products/coffee-box');
  assert.equal(server.productUrl('a b', { productPath: '/p?handle={handle}' }), '/p?handle=a%20b');
  assert.equal(shop.plans.allPlans(product).length, 2);
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
  await Promise.resolve(); await Promise.resolve();
  const root = document.querySelector('[tether-product]');
  assert.equal(root.getAttribute('tether-state'), 'ready', 'rendered from the server data, no loading state');
  assert.match(document.getElementById('price').textContent, /30/);
  await tick(60);
  assert.equal(calls.filter((c) => c.op === 'TetherProducts').length, 1, 'exactly one background refresh');
  assert.match(document.getElementById('price').textContent, /25/, 'live price after the refresh');
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
  await tick(60);
  const before = calls.filter((c) => c.op === 'TetherProducts').length;
  // page 2 carries the same stale build data
  Tether.unmount();
  document.body.innerHTML = page(shop.hydrate(old));
  Tether.mount(document);
  await tick(60);
  assert.equal(calls.filter((c) => c.op === 'TetherProducts').length, before, 'no second refresh');
  assert.match(document.getElementById('price').textContent, /22/, 'shows the live copy, not the build');
});

test('hydration: a server-rendered image with the same URL is not loaded again', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  const p = await shop.getProduct('coffee-box');
  const url = p.featuredImage?.url || p.images?.nodes?.[0]?.url;
  if (!url) return; // mock without images
  const src = shop.imageUrl(url, { width: 800 });
  document.body.innerHTML = `${shop.hydrate(p)}<div tether-product="coffee-box"><img id="im" tether-bind="image" src="${src}" alt="x"></div>`;
  const img = document.getElementById('im');
  Tether.mount(document);
  await tick(60);
  assert.equal(document.getElementById('im'), img);
  assert.equal(img.getAttribute('src'), src, 'src untouched');
});

test('hydration: data made for another market is ignored (Tether fetches its own)', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'DE' });
  document.body.innerHTML = page(shop.hydrate(product));
  Tether.mount(document);
  await tick();
  assert.equal(calls.filter((c) => c.op === 'TetherProducts').length, 1);
});

test('hydration: revalidate:false skips the background refresh', async () => {
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', revalidate: false });
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL' });
  document.body.innerHTML = page(shop.hydrate(product));
  Tether.mount(document);
  await tick(60);
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
  await tick();
  assert.equal(document.querySelector('h1').textContent, 'Coffee Box');
});

test('cart.subscribe gives the cart now and after every change; unsubscribe stops it', async () => {
  localStorage.clear();
  const seen = [];
  const off = Tether.cart.subscribe((cart, meta) => seen.push(meta.count));
  await Tether.cart.add({ variantId: '10' });
  off();
  const before = seen.length;
  await Tether.cart.add({ variantId: '10' });
  assert.deepEqual(seen.slice(0, 2), [0, 1]);
  assert.equal(seen.length, before, 'nothing after unsubscribe');
});

// ---- the Astro integration ---------------------------------------------------

test('integration: injects the page script with .env values, drops functions with a warning', async () => {
  const { default: tether } = await import('../src/astro.js');
  const prev = { ...process.env };
  process.env.PUBLIC_SHOPIFY_DOMAIN = 'env-shop.myshopify.com';
  process.env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN = 'env-token';
  const scripts = [];
  const warnings = [];
  await tether({ country: 'NL', onError: () => {} }).hooks['astro:config:setup']({
    injectScript: (stage, code) => scripts.push({ stage, code }), command: 'build',
    config: { root: new URL('file:///tmp/astro-site/') }, logger: { warn: (m) => warnings.push(m) },
  });
  process.env = prev;
  assert.deepEqual(scripts.map((x) => x.stage), ['head-inline', 'page']);
  assert.match(scripts[0].code, /TETHER_INTEGRATION/, 'no second auto-start from window.TETHER_CONFIG');
  const page = scripts[1].code;
  assert.match(page, /import Tether from '@occluze\/tether'/);
  assert.match(page, /"domain":"env-shop\.myshopify\.com"/);
  assert.match(page, /"country":"NL"/);
  assert.ok(!/onError/.test(page));
  assert.match(warnings.join(' '), /onError: functions can't be passed here/);
});

test('integration: warns clearly when the store is missing', async () => {
  const { default: tether } = await import('../src/astro.js');
  const prev = { ...process.env };
  delete process.env.PUBLIC_SHOPIFY_DOMAIN;
  delete process.env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  const warnings = [];
  await tether().hooks['astro:config:setup']({ injectScript() {}, command: 'dev', config: { root: new URL('file:///tmp/none/') }, logger: { warn: (m) => warnings.push(m) } });
  process.env = prev;
  assert.match(warnings.join(' '), /PUBLIC_SHOPIFY_DOMAIN and PUBLIC_SHOPIFY_STOREFRONT_TOKEN/);
});

test('integration: reads .env, .env.local and .env.production like Vite (process.env wins)', async () => {
  const { default: tether } = await import('../src/astro.js');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'astro env '));
  await writeFile(join(dir, '.env'), '# comment\nPUBLIC_SHOPIFY_DOMAIN=from-env.myshopify.com\nPUBLIC_SHOPIFY_STOREFRONT_TOKEN="quoted-token" # note\n');
  await writeFile(join(dir, '.env.production'), 'PUBLIC_SHOPIFY_DOMAIN=prod.myshopify.com\n');
  const prev = { ...process.env };
  delete process.env.PUBLIC_SHOPIFY_DOMAIN;
  delete process.env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  const scripts = [];
  await tether().hooks['astro:config:setup']({ injectScript: (s, c) => scripts.push(c), command: 'build', config: { root: new URL(`file://${dir}/`) }, logger: { warn() {} } });
  process.env = prev;
  assert.match(scripts[1], /"domain":"prod\.myshopify\.com"/, '.env.production wins over .env');
  assert.match(scripts[1], /"token":"quoted-token"/);
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
  await tick(60);
  const vis = (id) => window.getComputedStyle(document.getElementById(id)).display !== 'none';
  assert.ok(vis('a'), 'class-hidden shown');
  assert.ok(vis('b'), 'inline display:none shown');
  assert.ok(vis('c'), 'hidden attribute shown');
  assert.equal(document.getElementById('e').style.display, 'inline-flex', 'tether-display when CSS hides it');
  assert.ok(!vis('d'), 'false condition stays hidden');
});

test('cart.subscribe hears the saved cart once it has loaded', async () => {
  const seen = [];
  const off = Tether.cart.subscribe((cart, { count }) => seen.push(count));
  document.dispatchEvent(new window.CustomEvent('tether:cart-updated', { detail: {} })); // sanity: listener works
  await Tether.cart.init();
  off();
  assert.ok(seen.length >= 3, `called now, on the event and after load: ${seen}`);
});

test('cart: line links keep the chosen variant; checkout is marked disabled while the cart is empty', async () => {
  document.body.innerHTML = `<button id="co" tether-checkout>Checkout</button>
    <div tether-cart-lines><div><a tether-line="url">x</a></div></div>`;
  Tether.cart._commit(null, 'test');
  assert.equal(document.getElementById('co').getAttribute('aria-disabled'), 'true');
  const cart = await Tether.cart.add(product.variants.nodes[0].id, 1);
  assert.ok(cart);
  assert.equal(document.getElementById('co').getAttribute('aria-disabled'), 'false');
  assert.match(document.querySelector('[tether-line="url"]').getAttribute('href'), /\/products?\/coffee-box\?variant=\d+$/);
});

test('server initialState() matches what the browser shows first (variant, price, conditions)', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'NL', locale: 'nl-NL' });
  const cases = [
    product,
    { ...product, requiresSellingPlan: true }, // must be bought on a plan: plan price first
    { ...product, sellingPlanGroups: { nodes: [] }, variants: { nodes: product.variants.nodes.map((v, i) => ({ ...v, availableForSale: i > 0, quantityAvailable: 3, sellingPlanAllocations: { nodes: [] } })) } },
  ];
  const keys = ['in-stock', 'out-of-stock', 'low-stock', 'on-sale', 'subscription-available', 'subscription-only', 'one-time-available', 'subscription-selected', 'one-time-selected', 'has-variants'];
  for (const p of cases) {
    const st = shop.initialState(p);
    Tether.clearProductCache();
    Tether.primeProduct(p);
    document.body.innerHTML = `<div tether-product="${p.handle}"><span id="price" tether-bind="price"></span>
      ${keys.map((k) => `<i data-k="${k}" tether-show="${k}"></i>`).join('')}</div>`;
    Tether.mount(document);
    await tick(20);
    assert.equal(document.getElementById('price').textContent, shop.formatMoney(st.price), `price (${p.requiresSellingPlan ? 'plan' : 'one-time'})`);
    for (const el of document.querySelectorAll('[data-k]')) {
      assert.equal(el.style.display !== 'none', st.show[el.dataset.k], `${el.dataset.k} for case ${cases.indexOf(p)}`);
    }
    assert.equal(Tether.getScope(document.querySelector('[tether-product]')).variant.id, st.variant.id);
  }
});

test('cart warnings: less stock than asked is shown, and subscribe reports loaded + warnings', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    if (/Tether_cartLinesAdd|Tether_cartCreate/.test(query)) {
      assert.match(query, /warnings \{ code message \}/);
      const lines = variables.lines || variables.input.lines;
      const key = /cartCreate/.test(query) ? 'cartCreate' : 'cartLinesAdd';
      return { ok: true, status: 200, json: async () => ({ data: { [key]: { cart: cartFrom(lines), userErrors: [], warnings: [{ code: 'MERCHANDISE_NOT_ENOUGH_STOCK', message: 'Only 1 left' }] } } }) };
    }
    return realFetch(url, init);
  };
  try {
    document.body.innerHTML = '<p id="w" tether-show="cart-warning" hidden><span tether-cart-warning></span></p>';
    let meta;
    const off = Tether.cart.subscribe((c, m) => { meta = m; });
    await Tether.cart.add(product.variants.nodes[0].id, 5);
    off();
    assert.equal(meta.loaded, true);
    assert.equal(meta.warnings[0].code, 'MERCHANDISE_NOT_ENOUGH_STOCK');
    assert.notEqual(window.getComputedStyle(document.getElementById('w')).display, 'none');
    assert.equal(document.querySelector('[tether-cart-warning]').textContent, 'Only 1 left');
  } finally { globalThis.fetch = realFetch; }
});

test('another language: translated option names (Size -> Größe) still match the markup by position', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'DE', language: 'DE' });
  const de = JSON.parse(JSON.stringify(product).replace(/"Size"/g, '"Größe"').replace(/"1kg"/g, '"1 kg"'));
  // The build (NL, English names) put its data in the page; the visitor is in another language.
  document.body.innerHTML = `${server.createStorefront({ domain: 'shop.test', token: 't', country: 'XX' }).hydrate(product)}
    <div tether-product="coffee-box">
      <span id="sel" tether-option-selected="Size"></span>
      <div tether-option-list="Size"><button>250g</button></div>
    </div>`;
  Tether.clearProductCache();
  Tether.primeProduct(de);
  Tether.mount(document);
  await tick(20);
  const btns = document.querySelectorAll('[tether-option-list] [tether-option-value]');
  assert.equal(btns.length, 2, 'values from the translated product');
  btns[1].click();
  const scope = Tether.getScope(document.querySelector('[tether-product]'));
  assert.equal(scope.variant.selectedOptions[0].value, '1 kg');
  assert.equal(document.getElementById('sel').textContent, '1 kg');
  void shop;
});
