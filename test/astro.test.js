// Server module, hydration, Astro View Transitions, cart.subscribe, the Astro integration.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { product, cartFrom } from './fixtures.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://astro.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window.Option,
  getComputedStyle: dom.window.getComputedStyle,
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
    Object.keys(variables).forEach((k) => {
      if (k.startsWith('h')) data[k] = variables[k] === product.handle ? withPrice(product, livePrice) : null;
    });
    return ok(data);
  }
  if (op === 'TetherServerProduct')
    return ok({ product: variables.handle === product.handle ? withPrice(product, livePrice) : null });
  if (op === 'TetherServerProductById') return ok({ node: variables.id === product.id ? product : null });
  if (op === 'TetherServerProducts') {
    const all = Array.from({ length: 5 }, (_, i) => ({
      ...product,
      id: `gid://shopify/Product/${i + 1}`,
      handle: `p-${i + 1}`,
    }));
    const start = variables.after ? Number(variables.after) : 0;
    const page = all.slice(start, start + variables.first);
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
        products: variables.q.startsWith('cof')
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
        queries: variables.q.startsWith('cof') ? [{ text: 'coffee beans' }] : [],
      },
    });
  if (op === 'TetherSearch') return ok({ products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
  if (op === 'TetherCart') return ok({ cart: null });
  if (op === 'Tether_cartCreate') return ok({ cartCreate: { cart: cartFrom(variables.input.lines), userErrors: [] } });
  if (op === 'Tether_cartLinesAdd')
    return ok({ cartLinesAdd: { cart: cartFrom([...variables.lines, ...variables.lines]), userErrors: [] } });
  if (op === 'Tether_cartLinesUpdate') {
    await new Promise((r) => setTimeout(r, 30)); // a slow network, so clicks overlap
    const c = cartFrom([{ merchandiseId: product.variants.nodes[0].id, quantity: variables.lines[0].quantity }]);
    c.lines.nodes[0].id = variables.lines[0].id;
    return ok({ cartLinesUpdate: { cart: c, userErrors: [] } });
  }
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
beforeEach(() => {
  calls.length = 0;
  livePrice = '30';
  Tether.clearProductCache();
});

// ---- server module ---------------------------------------------------------

test('server: createStorefront(import.meta.env) maps the PUBLIC_SHOPIFY_* names and ignores other keys', () => {
  const shop = server.createStorefront({
    PUBLIC_SHOPIFY_DOMAIN: 'https://x.myshopify.com/',
    PUBLIC_SHOPIFY_STOREFRONT_TOKEN: 'tok',
    MODE: 'production',
    BASE_URL: '/',
  });
  assert.equal(shop.config.domain, 'x.myshopify.com');
  assert.equal(shop.config.token, 'tok');
  assert.ok(!('MODE' in shop.config));
  assert.throws(() => server.createStorefront({}), /needs domain and token/);
});

test('server: the config is resolved as the browser’s: an invalid count falls back to its default', () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', imagesFirst: -1, variantsFirst: 'many' });
  assert.equal(shop.config.imagesFirst, 25);
  assert.equal(shop.config.variantsFirst, 100);
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
  assert.deepEqual(
    all.map((p) => p.handle),
    ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
  );
  assert.equal(calls.filter((c) => c.op === 'TetherServerProducts').length, 3);
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
    injectScript: (stage, code) => scripts.push({ stage, code }),
    command: 'build',
    config: { root: pathToFileURL(join(tmpdir(), 'astro-site/')) },
    logger: { warn: (m) => warnings.push(m) },
  });
  process.env = prev;
  assert.deepEqual(
    scripts.map((x) => x.stage),
    ['head-inline', 'page'],
  );
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
  await tether().hooks['astro:config:setup']({
    injectScript() {},
    command: 'dev',
    config: { root: pathToFileURL(join(tmpdir(), 'none/')) },
    logger: { warn: (m) => warnings.push(m) },
  });
  process.env = prev;
  assert.match(warnings.join(' '), /PUBLIC_SHOPIFY_DOMAIN and PUBLIC_SHOPIFY_STOREFRONT_TOKEN/);
});

test('integration: reads .env, .env.local and .env.production like Vite (process.env wins)', async () => {
  const { default: tether } = await import('../src/astro.js');
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
  delete process.env.PUBLIC_SHOPIFY_DOMAIN;
  delete process.env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  const scripts = [];
  await tether().hooks['astro:config:setup']({
    injectScript: (s, c) => scripts.push(c),
    command: 'build',
    config: { root: pathToFileURL(`${dir}/`) },
    logger: { warn() {} },
  });
  process.env = prev;
  assert.match(scripts[1], /"domain":"prod\.myshopify\.com"/, '.env.production wins over .env');
  assert.match(scripts[1], /"token":"quoted-token"/);
});

test('integration: --mode picks the .env file; shop.config.js changes restart the dev server', async () => {
  const { default: tether } = await import('../src/astro.js');
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
  delete process.env.PUBLIC_SHOPIFY_DOMAIN;
  delete process.env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  process.argv = [...argv, '--mode', 'staging'];
  const scripts = [];
  const watched = [];
  try {
    await tether().hooks['astro:config:setup']({
      injectScript: (s, c) => scripts.push(c),
      command: 'dev',
      addWatchFile: (f) => watched.push(String(f)),
      config: { root: pathToFileURL(`${dir}/`) },
      logger: { warn() {} },
    });
  } finally {
    process.env = prev;
    process.argv = argv;
  }
  assert.match(scripts[1], /"domain":"staging\.myshopify\.com"/);
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
  assert.match(
    document.querySelector('[tether-line="url"]').getAttribute('href'),
    /\/products?\/coffee-box\?variant=\d+$/,
  );
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
        nodes: product.variants.nodes.map((v, i) => ({
          ...v,
          availableForSale: i > 0,
          quantityAvailable: 3,
          sellingPlanAllocations: { nodes: [] },
        })),
      },
    },
  ];
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
  for (const p of cases) {
    const st = shop.initialState(p);
    Tether.clearProductCache();
    Tether.primeProduct(p);
    document.body.innerHTML = `<div tether-product="${p.handle}"><span id="price" tether-bind="price"></span>
      ${keys.map((k) => `<i data-k="${k}" tether-show="${k}"></i>`).join('')}</div>`;
    Tether.mount(document);
    await tick(20);
    assert.equal(
      document.getElementById('price').textContent,
      shop.formatMoney(st.price),
      `price (${p.requiresSellingPlan ? 'plan' : 'one-time'})`,
    );
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
      assert.match(query, /warnings \{ code message target \}/);
      const lines = variables.lines || variables.input.lines;
      const key = /cartCreate/.test(query) ? 'cartCreate' : 'cartLinesAdd';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            [key]: {
              cart: cartFrom(lines),
              userErrors: [],
              warnings: [{ code: 'MERCHANDISE_NOT_ENOUGH_STOCK', message: 'Only 1 left' }],
            },
          },
        }),
      };
    }
    return realFetch(url, init);
  };
  try {
    document.body.innerHTML = '<p id="w" tether-show="cart-warning" hidden><span tether-cart-warning></span></p>';
    let meta;
    const off = Tether.cart.subscribe((c, m) => {
      meta = m;
    });
    await Tether.cart.add(product.variants.nodes[0].id, 5);
    off();
    assert.equal(meta.loaded, true);
    assert.equal(meta.warnings[0].code, 'MERCHANDISE_NOT_ENOUGH_STOCK');
    assert.notEqual(window.getComputedStyle(document.getElementById('w')).display, 'none');
    assert.equal(document.querySelector('[tether-cart-warning]').textContent, 'Only 1 left');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('another language: translated option names (Size -> Größe) still match the markup by position', async () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', country: 'DE', language: 'DE' });
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
  await tick(20);
  const btns = document.querySelectorAll('[tether-option-list] [tether-option-value]');
  assert.equal(btns.length, 2, 'values from the translated product');
  btns[1].click();
  const scope = Tether.getScope(document.querySelector('[tether-product]'));
  assert.equal(scope.variant.selectedOptions[0].value, '1 kg');
  assert.equal(document.getElementById('sel').textContent, '1 kg');
  void shop;
});

// ---- reported by the 10 store builders / shoppers ---------------------------

test('cart: quick +/+ clicks add up (each builds on the last one asked for), the line is busy meanwhile', async () => {
  const cart = cartFrom([{ merchandiseId: product.variants.nodes[0].id, quantity: 1 }]);
  Tether.cart._commit(cart, 'test');
  const lineId = cart.lines.nodes[0].id;
  document.body.innerHTML = `<div tether-cart-lines><div><span tether-line="quantity"></span><button tether-line-plus>+</button></div></div>`;
  Tether.cart.render();
  const line = document.querySelector('[tether-cart-lines] > *');
  const plus = line.querySelector('[tether-line-plus]');
  plus.click();
  plus.click();
  assert.equal(line.querySelector('[tether-line="quantity"]').textContent, '3', 'shown at once');
  assert.ok(line.classList.contains('is-busy'));
  await tick(150);
  const updates = calls.filter((c) => c.op === 'Tether_cartLinesUpdate').map((c) => c.variables.lines[0].quantity);
  assert.deepEqual(updates, [3], 'only the latest target is sent');
  assert.equal(Tether.cart.lines[0].quantity, 3);
  assert.ok(!document.querySelector('[tether-cart-lines] > *').classList.contains('is-busy'));
  void lineId;
});

test('cart: + + + - while Shopify answers slowly: the count never steps past the target', async () => {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    if (/cartLinesUpdate/.test(query)) {
      sent.push(variables.lines[0].quantity);
      await tick(30);
      const c = cartFrom([{ merchandiseId: product.variants.nodes[0].id, quantity: variables.lines[0].quantity }]);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { cartLinesUpdate: { cart: c, userErrors: [], warnings: [] } } }),
      };
    }
    return realFetch(url, init);
  };
  try {
    Tether.cart._commit(cartFrom([{ merchandiseId: product.variants.nodes[0].id, quantity: 1 }]), 'test');
    document.body.innerHTML =
      '<span tether-cart-count></span><div tether-cart-lines><div><span tether-line="quantity"></span><button tether-line-plus>+</button><button tether-line-minus>-</button></div></div>';
    Tether.cart.render();
    const counts = [];
    const off = Tether.cart.subscribe((c) => counts.push(c?.totalQuantity));
    const plus = document.querySelector('[tether-line-plus]');
    plus.click();
    await tick(5); // the first one is on its way
    plus.click();
    plus.click();
    document.querySelector('[tether-line-minus]').click();
    assert.equal(document.querySelector('[tether-line="quantity"]').textContent, '3');
    await tick(150);
    off();
    assert.deepEqual(sent, [2, 3], 'the first, then only the latest');
    assert.equal(document.querySelector('[tether-cart-count]').textContent, '3');
    assert.ok(
      counts.every((n) => n <= 3),
      `counts seen: ${counts}`,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('cart.open() works without a tether-cart-drawer (framework carts), subscribe reports it', async () => {
  document.body.innerHTML = '';
  let open = null;
  const off = Tether.cart.subscribe((c, m) => {
    open = m.open;
  });
  Tether.cart.open();
  assert.equal(Tether.cart.isOpen(), true);
  assert.equal(open, true);
  Tether.cart.close();
  assert.equal(open, false);
  off();
});

test('options: a value no variant has is ignored; an impossible combination keeps the most choices', async () => {
  const two = JSON.parse(JSON.stringify(product));
  two.options = [
    { name: 'Size', optionValues: [{ name: '250g' }, { name: '1kg' }] },
    { name: 'Roast', optionValues: [{ name: 'Light' }, { name: 'Dark' }, { name: 'Ember' }] },
  ];
  const mk = (i, size, roast) => ({
    ...two.variants.nodes[0],
    id: `gid://shopify/ProductVariant/9${i}`,
    availableForSale: true,
    selectedOptions: [
      { name: 'Size', value: size },
      { name: 'Roast', value: roast },
    ],
  });
  two.variants.nodes = [mk(1, '250g', 'Light'), mk(2, '1kg', 'Light'), mk(3, '1kg', 'Dark')];
  Tether.clearProductCache();
  Tether.primeProduct(two);
  document.body.innerHTML = '<div tether-product="coffee-box"></div>';
  Tether.mount(document);
  await tick(20);
  const scope = Tether.getScope(document.querySelector('[tether-product]'));
  scope.select('Size', '1kg');
  assert.equal(scope.variant.id, 'gid://shopify/ProductVariant/92');
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
  await tick(30);
  assert.equal(window.location.search, '', 'nothing on first render');
  Tether.getScope(document.querySelector('[tether-product]')).select('Size', '1kg');
  await tick(20); // written by the extras part
  assert.match(window.location.search, /variant=\d+/);
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', locale: 'nl-NL' });
  window.history.replaceState(null, '', '/');
});

test('tether-show="list-empty" with a hidden attribute is shown for an empty list', async () => {
  document.body.innerHTML =
    '<div tether-products="nothing-matches"><div tether-list><div></div></div><p id="e" tether-show="list-empty" hidden>None</p></div>';
  Tether.mount(document);
  await tick(80);
  assert.notEqual(window.getComputedStyle(document.getElementById('e')).display, 'none');
});

test('initialState has has-savings, plenty-in-stock, a plain unavailable map, and honours lowStock', () => {
  const shop = server.createStorefront({ domain: 'shop.test', token: 't', lowStock: 2 });
  const p = JSON.parse(JSON.stringify(product));
  p.variants.nodes.forEach((v) => {
    v.quantityAvailable = 3;
  });
  const st = shop.initialState(p);
  assert.equal(typeof st.show['has-savings'], 'boolean');
  assert.equal(st.show['low-stock'], false, '3 > lowStock 2');
  assert.equal(st.show['plenty-in-stock'], true);
  assert.ok(Array.isArray(st.unavailable.Size));
  assert.doesNotThrow(() => JSON.stringify(st.unavailable));
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
  assert.equal(document.querySelector('[tether-product]').getAttribute('tether-state'), 'ready');
  assert.match(document.getElementById('p').textContent, /30/);
  // Cards keep a hover image (image:2), more on request.
  const many = {
    ...product,
    images: {
      nodes: ['a', 'b', 'c', 'd'].map((n) => ({
        url: `https://cdn.shopify.com/${n}.jpg`,
        altText: null,
        width: 10,
        height: 10,
      })),
    },
  };
  const imgs = (tag) => JSON.parse(tag.replace(/^<script[^>]*>|<\/script>$/g, '')).products[0].images.nodes.length;
  assert.equal(imgs(shop.hydrate(many, { card: true })), 2);
  assert.equal(imgs(shop.hydrate(many, { card: true, images: 3 })), 3);
  assert.equal(imgs(shop.hydrate(many)), 4);
});

test('queries carry a maxAge bucket (Shopify caches identical query texts); mutations and maxAge: 0 do not', async () => {
  const bodies = [];
  const shop = server.createStorefront({
    domain: 'shop.test',
    token: 't',
    fetch: async (u, i) => {
      bodies.push(JSON.parse(i.body).query);
      return { ok: true, status: 200, json: async () => ({ data: { product: null } }) };
    },
  });
  await shop.getProduct('x');
  assert.match(bodies[0], / #\d+$/);
  const none = server.createStorefront({
    domain: 'shop.test',
    token: 't',
    maxAge: 0,
    fetch: async (u, i) => {
      bodies.push(JSON.parse(i.body).query);
      return { ok: true, status: 200, json: async () => ({ data: { product: null } }) };
    },
  });
  await none.getProduct('x');
  assert.doesNotMatch(bodies[1], /#\d+$/);
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
  const d = shop.jsonLdData(product);
  assert.ok(['Product', 'ProductGroup'].includes(d['@type']));
  const offers = d.offers ? [d.offers] : d.hasVariant.map((v) => v.offers);
  assert.ok(
    offers.every(
      (o) => o.price && o.priceCurrency && /schema.org\/(InStock|OutOfStock|BackOrder)/.test(o.availability),
    ),
  );
  assert.match(d.url, /^https:\/\/shop\.example\/products\/coffee-box$/);
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
  await tick(30); // the part loads
  const input = document.querySelector('[tether-search-input]');
  const type = (v) => {
    input.value = v;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  type('c');
  type('co');
  type('cof');
  await tick(250);
  const root = document.querySelector('[tether-search]');
  assert.equal(root.getAttribute('tether-search-state'), 'ready');
  assert.equal(calls.filter((c) => c.op === 'TetherPredictive').length, 1, 'debounced: one request');
  const link = document.querySelector('[tether-search-products] a');
  assert.equal(link.querySelector('[tether-search-bind="title"]').textContent, product.title);
  assert.match(link.getAttribute('href'), /coffee-box/);
  assert.match(document.querySelector('[tether-search-queries] a').getAttribute('href'), /\/search\?q=coffee%20beans/);
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  assert.equal(input.getAttribute('aria-activedescendant'), link.id);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  type('zzz');
  await tick(250);
  assert.equal(root.getAttribute('tether-search-state'), 'empty');
  assert.notEqual(window.getComputedStyle(document.querySelector('[tether-show="search-empty"]')).display, 'none');
});

test('a page built for another market: html.tether-market-pending until the live prices are in', async () => {
  const de = server.createStorefront({ domain: 'shop.test', token: 't', country: 'DE' });
  document.documentElement.classList.remove('tether-market-pending');
  document.body.innerHTML = `${de.hydrate(product)}<div tether-product="coffee-box"><span tether-bind="price">built price</span></div>`;
  Tether.mount(document);
  assert.ok(document.documentElement.classList.contains('tether-market-pending'));
  await tick(80);
  assert.ok(!document.documentElement.classList.contains('tether-market-pending'));
});

// ---- analytics, customer accounts -------------------------------------------

test('analytics: GA4 dataLayer events from Tether (view_item, add_to_cart from cart changes, view_cart, begin_checkout)', async () => {
  window.dataLayer = [];
  const a = await import('../src/analytics.js');
  const prev = Tether.config.analytics;
  Tether.config.analytics = { dataLayer: true };
  const q = [];
  await a.startAnalytics(q);
  Tether.clearProductCache();
  Tether.primeProduct(product);
  document.body.innerHTML = '<div tether-product="coffee-box"></div>';
  Tether.mount(document);
  await tick(20);
  const root = document.querySelector('[tether-product]');
  q.push(new window.CustomEvent('tether:product-ready', { detail: { product, scope: Tether.getScope(root) } }));
  const line = (qty) => cartFrom([{ merchandiseId: product.variants.nodes[0].id, quantity: qty }]);
  q.push(new window.CustomEvent('tether:cart-updated', { detail: { cart: line(1), reason: 'load' } }));
  q.push(new window.CustomEvent('tether:cart-updated', { detail: { cart: line(3), reason: 'add' } }));
  q.push(new window.CustomEvent('tether:checkout', { detail: { cart: line(3) } }));
  const events = window.dataLayer.filter((x) => x.event).map((x) => x.event);
  assert.deepEqual(events, ['view_item', 'add_to_cart', 'begin_checkout']);
  const add = window.dataLayer.find((x) => x.event === 'add_to_cart');
  assert.equal(add.ecommerce.items[0].quantity, 2, 'the difference');
  assert.equal(typeof add.ecommerce.value, 'number');
  assert.ok(
    window.dataLayer.some((x) => x.ecommerce === null),
    'cleared before each push',
  );
  Tether.config.analytics = prev;
});

test('customer accounts: PKCE login URL, callback checks state/nonce, cart linked, logout', async () => {
  const acc = await import('../src/account.js');
  const nav = [];
  Tether.config.account = { clientId: 'client-1', navigate: (u) => nav.push(u) };
  const realFetch = globalThis.fetch;
  let idTokenNonce = null;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (u.endsWith('/.well-known/openid-configuration'))
      return json({
        issuer: 'https://shopify.com/authentication/1',
        authorization_endpoint: 'https://shopify.com/authentication/1/oauth/authorize',
        token_endpoint: 'https://shopify.com/authentication/1/oauth/token',
        end_session_endpoint: 'https://shopify.com/authentication/1/logout',
      });
    if (u.endsWith('/.well-known/customer-account-api'))
      return json({ graphql_api: 'https://shopify.com/1/account/customer/api/2026-10/graphql' });
    if (u.endsWith('/oauth/token')) {
      const body = new URLSearchParams(init.body);
      assert.equal(init.headers, undefined, 'a simple request: no custom headers');
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.ok(body.get('code_verifier').length >= 43);
      const payload = btoa(
        JSON.stringify({
          iss: 'https://shopify.com/authentication/1',
          aud: 'client-1',
          nonce: idTokenNonce,
          exp: Date.now() / 1000 + 3600,
        }),
      );
      return json({ access_token: 'tok-1', refresh_token: 'ref-1', id_token: `x.${payload}.y`, expires_in: 3600 });
    }
    if (u.includes('/account/customer/api/')) {
      assert.equal(init.headers.Authorization, 'tok-1');
      return json({
        data: {
          customer: {
            id: 'c1',
            firstName: 'Ada',
            lastName: 'L',
            displayName: 'Ada L',
            emailAddress: { emailAddress: 'a@x.test' },
          },
        },
      });
    }
    return realFetch(url, init);
  };
  try {
    await acc.login({ returnTo: 'https://astro.test/account' });
    const authorize = new URL(nav.pop());
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorize.searchParams.get('client_id'), 'client-1');
    const state = authorize.searchParams.get('state');
    idTokenNonce = authorize.searchParams.get('nonce');
    // A wrong state is ignored.
    window.history.replaceState(null, '', '/account?code=abc&state=wrong');
    assert.equal(await acc.handleCallback(), false);
    window.history.replaceState(null, '', `/account?code=abc&state=${state}`);
    let loginEvent = 0;
    window.addEventListener('tether:account-login', () => {
      loginEvent++;
    });
    assert.equal(await acc.handleCallback(), true);
    assert.equal(loginEvent, 1, 'tether:account-login reaches window listeners');
    assert.equal(window.location.search, '', 'code removed from the URL');
    assert.equal(Tether.cart.customerAccessToken, 'tok-1');
    assert.equal((await acc.customer()).firstName, 'Ada');
    document.body.innerHTML =
      '<span id="n" tether-account-bind="first-name"></span><p id="out" tether-show="logged-out">x</p>';
    await acc.render(document);
    assert.equal(document.getElementById('n').textContent, 'Ada');
    assert.equal(window.getComputedStyle(document.getElementById('out')).display, 'none');
    await acc.logout();
    assert.match(nav.pop(), /\/logout\?id_token_hint=/);
    assert.equal(Tether.cart.customerAccessToken, null);
  } finally {
    globalThis.fetch = realFetch;
    Tether.config.account = null;
    window.history.replaceState(null, '', '/');
  }
});

test('customer accounts in server mode: no token in the browser, the Worker does the work', async () => {
  const acc = await import('../src/account.js');
  const nav = [];
  Tether.config.account = { server: '/_tether/account', navigate: (u) => nav.push(u) }; // a path on this site works too
  const realFetch = globalThis.fetch;
  const asked = [];
  let noOrders = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://astro.test/_tether/account')) {
      asked.push({ path: new URL(u).pathname.split('/').pop(), init });
      assert.equal(init.credentials, 'include');
      const json = (d) => ({ ok: true, status: 200, json: async () => d });
      if (u.endsWith('/me')) return json({ loggedIn: true, customer: { firstName: 'Ada', email: 'ada@x.test' } });
      if (u.includes('/orders'))
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
      if (u.endsWith('/cart')) {
        assert.equal(init.headers['X-Tether-Account'], '1');
        return json({ linked: true, checkoutUrl: 'https://shop.test/checkouts/c/1' });
      }
      if (u.endsWith('/logout')) return json({ logoutUrl: 'https://shopify.com/logout?x' });
    }
    return realFetch(url, init);
  };
  try {
    Tether.cart._commit(cartFrom([{ merchandiseId: product.variants.nodes[0].id, quantity: 1 }]), 'test');
    await acc.login();
    const to = new URL(nav.pop());
    assert.equal(to.pathname, '/_tether/account/login');
    assert.equal(to.searchParams.get('cart'), null, 'no cart on the login link (linked through POST /cart)');
    window.history.replaceState(null, '', '/account?account=in');
    document.body.innerHTML = `<span id="n" tether-account-bind="first-name"></span>
      <ul tether-orders><li><span tether-order-bind="name"></span><img id="oi" tether-order-bind="image">
        <div tether-order-lines><p><span tether-order-line="quantity"></span>x <span tether-order-line="title"></span> <span tether-order-line="variant-title"></span></p></div></li></ul>
      <p id="ol" tether-show="orders-loading"></p><p id="oe" tether-show="orders-empty"></p>`;
    await acc.mountAccount(document);
    const visible = (id) => window.getComputedStyle(document.getElementById(id)).display !== 'none';
    assert.match(document.getElementById('oi').getAttribute('src'), /tee\.jpg/);
    assert.equal(document.querySelector('[tether-order-lines] p').textContent.replace(/\s+/g, ' ').trim(), '2x Tee M');
    assert.ok(!visible('ol') && !visible('oe'));
    assert.equal(document.querySelector('[tether-order-bind="name"]').textContent, '#1001');
    noOrders = true;
    await acc.render(document);
    assert.ok(visible('oe'), 'no orders yet');
    noOrders = false;
    assert.equal(window.location.search, '', '?account=in removed');
    assert.equal(document.getElementById('n').textContent, 'Ada');
    assert.equal(await acc.getToken(), null, 'never a token');
    await assert.rejects(acc.query('{ customer { id } }'), /server mode/);
    const url = await Tether.cart.beforeCheckout();
    assert.match(url, /checkouts\/c\/1\?logged_in=true/);
    const stored = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    assert.ok(
      !/access|refresh|token/i.test(stored.replace(/account-hint/g, '')),
      'nothing secret stored in the browser',
    );
    await acc.logout();
    assert.match(nav.pop(), /shopify\.com\/logout/);
  } finally {
    globalThis.fetch = realFetch;
    Tether.config.account = null;
    Tether.cart.beforeCheckout = undefined;
    window.history.replaceState(null, '', '/');
  }
});

test('a rejected token says why: Shopify sends 401 with an empty message', async () => {
  const fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ errors: [{ message: '', extensions: { code: 'UNAUTHORIZED' } }] }),
  });
  const shop = server.createStorefront({ domain: 'wrong.myshopify.com', token: 'shpat_abc', fetch });
  await assert.rejects(shop.getProduct('x'), (err) => {
    assert.match(err.message, /rejected the Storefront token for wrong\.myshopify\.com \(401\)/);
    assert.match(err.message, /not an Admin API token/);
    return true;
  });
  const empty = server.createStorefront({
    domain: 'wrong.myshopify.com',
    token: 't',
    fetch: async () => ({
      ok: false,
      status: 403,
      json: async () => {
        throw new Error('no json');
      },
    }),
  });
  await assert.rejects(empty.getProduct('x'), /rejected the Storefront token .*\(403\)/);
});

test('image size attributes: max-width, or valid HTML tether-max-width / data-max-width', async () => {
  const { cdnUrl } = await import('../src/dom.js');
  const img = (a) => {
    const el = document.createElement('img');
    Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };
  const u = 'https://cdn.shopify.com/a.jpg';
  assert.match(cdnUrl(u, img({ 'max-width': '400' })), /width=400/);
  assert.match(cdnUrl(u, img({ 'tether-max-width': '500' })), /width=500/);
  assert.match(
    cdnUrl(u, img({ 'data-max-width': '600', 'data-crop': 'center', 'data-max-height': '600' })),
    /width=600/,
  );
});

test('tether-products="url:q": a search results page on a static site', async () => {
  window.history.replaceState(null, '', '/search?q=tee%20shirt');
  calls.length = 0;
  document.body.innerHTML = '<div tether-products="url:q"><div tether-list><div></div></div></div>';
  Tether.mount(document);
  await tick(60);
  const search = calls.find((c) => c.op === 'TetherSearch');
  assert.equal(search?.variables.query, 'tee shirt');
  window.history.replaceState(null, '', '/');
});

test('account pages (server mode): order page with returns, subscriptions with actions, addresses, profile', async () => {
  const acc = await import('../src/account.js?pages'); // a fresh instance: an earlier test logged out
  Tether.config.account = {
    server: '/_tether/account',
    orderUrl: '/account/order?id={id}',
    subscriptionsUrl: 'https://shopify.com/1/account/pages/subs',
  };
  const realFetch = globalThis.fetch;
  const posts = [];
  let status = 'ACTIVE';
  const money = (a) => ({ amount: a, currencyCode: 'EUR' });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'https://astro.test');
    if (!u.pathname.startsWith('/_tether/account')) return realFetch(url, init);
    const path = u.pathname.slice('/_tether/account'.length);
    const ok = (d) => ({ ok: true, status: 200, json: async () => d });
    if (init.method === 'POST') {
      assert.equal(init.headers['X-Tether-Account'], '1');
      posts.push({ path, body: JSON.parse(init.body) });
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
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: 'City is required', userErrors: [{ message: 'City is required' }] }),
      };
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
    let routerSaw = null;
    const router = (e) => {
      routerSaw = e.defaultPrevented;
    };
    document.addEventListener('submit', router);
    await acc.mountAccount(document);
    const $ = (q) => document.querySelector(q);
    const visible = (el) => window.getComputedStyle(el).display !== 'none';
    assert.equal($('#subs').getAttribute('href'), 'https://shopify.com/1/account/pages/subs');
    assert.equal(
      $('[tether-orders] a').getAttribute('href'),
      '/account/order?id=7',
      "list links to the site's own order page",
    );
    assert.equal($('[tether-order] h1').textContent, '#1007');
    assert.equal($('#ship').textContent, 'Street 1, Utrecht');
    assert.equal($('[tether-order-line="title"]').textContent, 'Tee');
    assert.equal($('[tether-fulfillment-bind="company"]').textContent, 'PostNL');
    assert.equal($('[tether-fulfillment-bind="url"]').getAttribute('href'), 'https://track.example/3S123');
    assert.equal($('[tether-return-quantity]').max, '2');
    assert.equal($('[tether-return-reason]').options.length, 1);
    assert.ok(visible($('#ret')));
    assert.ok(!visible($('[tether-order-show="loading"]')));
    // Subscriptions: rendered, states, actions follow the status.
    assert.equal($('[tether-subscription-bind="status"]').textContent, 'active');
    assert.equal($('[tether-subscription-bind="interval"]').textContent, 'month');
    assert.ok(!visible($('#sl')) && !visible($('#se')));
    assert.equal($('#resume').disabled, true);
    $('#pause').click();
    await tick(60);
    assert.deepEqual(posts.find((p) => p.path === '/subscription').body, {
      id: 'gid://shopify/SubscriptionContract/5',
      action: 'pause',
    });
    assert.equal($('[tether-subscription-bind="status"]').textContent, 'paused');
    assert.ok(visible($('[tether-subscription-show="paused"]')));
    assert.equal($('#pause').disabled, true);
    // Return request: only lines with a quantity.
    $('[tether-return-quantity]').value = '1';
    $('#ret').click();
    await tick(60);
    assert.deepEqual(posts.find((p) => p.path === '/return').body, {
      orderId: 'gid://shopify/Order/7',
      lines: [
        { lineItemId: 'gid://shopify/LineItem/1', quantity: 1, reasonId: 'gid://shopify/ReturnReasonDefinition/1' },
      ],
    });
    assert.ok(visible($('#done')));
    // Addresses: list with default; a Shopify error shows in the form.
    assert.equal($('[tether-address-bind="formatted"]').textContent, 'Street 1, Utrecht');
    assert.ok(visible($('[tether-address-show="default"]')));
    $('[tether-address-form]').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
    $('[tether-address-form]').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true })); // Enter twice
    document.removeEventListener('submit', router);
    assert.equal(routerSaw, true, 'account forms are handled in the capture phase, before a router');
    await tick(40);
    assert.equal($('[tether-address-form]').getAttribute('tether-form-state'), 'error');
    assert.equal($('[tether-address-form] [tether-form-error]').textContent, 'City is required');
    assert.equal(posts.filter((p) => p.path === '/address').length, 1, 'a second submit while sending sends nothing');
    // Profile form prefilled.
    assert.equal($('[tether-profile-form] [name="firstName"]').value, 'Ada');
  } finally {
    globalThis.fetch = realFetch;
    Tether.config.account = null;
    window.history.replaceState(null, '', '/');
  }
});

test('integration: a secret Shopify token is never written into pages, and a non-PUBLIC name is flagged', async () => {
  const { default: tether } = await import('../src/astro.js');
  const prev = { ...process.env };
  const setup = (warnings, scripts = []) =>
    tether().hooks['astro:config:setup']({
      injectScript: (stage, code) => scripts.push(code),
      command: 'build',
      config: { root: pathToFileURL(join(tmpdir(), 'astro-secret/')) },
      logger: { warn: (m) => warnings.push(m) },
    });
  try {
    delete process.env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
    process.env.PUBLIC_SHOPIFY_DOMAIN = 'shop.myshopify.com';
    process.env.SHOPIFY_STOREFRONT_TOKEN = 'shpat_0123456789abcdef';
    const scripts = [];
    await assert.rejects(setup([], scripts), /secret token/);
    assert.ok(!scripts.join('').includes('shpat_'), 'nothing was injected');

    process.env.SHOPIFY_STOREFRONT_TOKEN = '0123456789abcdef0123456789abcdef';
    const warnings = [];
    await setup(warnings);
    assert.match(warnings.join(' '), /SHOPIFY_STOREFRONT_TOKEN is written into every page/);
  } finally {
    process.env = prev;
  }
});
