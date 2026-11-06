import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  cartFrom,
  fakeLine,
  find,
  findAll,
  graphqlRequest,
  jsonResponse,
  linesAt,
  operationName,
  PLAN_2MONTH,
  PLAN_MONTH,
  product,
} from './fixtures.js';
import { listAt, recordAt, recordsAt, stringAt, waitFor } from '../server/test/mocks.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/product/coffee-box' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window['Option'],
  getComputedStyle: dom.window.getComputedStyle,
});

// ---- fake Storefront API ---------------------------------------------------
/** @type {({ op: string } & ReturnType<typeof graphqlRequest>)[]} */
const calls = [];
/** @type {import('./fixtures.js').FakeLine[]} */
let cartLines = [];
/**
 * @param {RequestInfo | URL} _url
 * @param {RequestInit} [init]
 */
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  const op = operationName(query);
  calls.push({ op, query, variables });
  /** @param {unknown} data */
  const ok = (data) => jsonResponse({ data });
  const payload = () => ({ cart: cartFrom(cartLines), userErrors: [] });

  switch (op) {
    case 'TetherProducts': {
      /** @type {Record<string, import('../src/fragments.ts').Product | null>} */
      const data = {};
      Object.keys(variables).forEach((key) => {
        if (key.startsWith('h')) data[key] = variables[key] === product.handle ? product : null;
      });
      return ok(data);
    }
    case 'TetherCart':
      return ok({ cart: cartLines.length ? cartFrom(cartLines) : null });
    case 'Tether_cartCreate':
      cartLines = linesAt(recordAt(variables, 'input'), 'lines');
      return ok({ cartCreate: payload() });
    case 'Tether_cartLinesAdd':
      cartLines = [...cartLines, ...linesAt(variables, 'lines')];
      return ok({ cartLinesAdd: payload() });
    case 'Tether_cartLinesUpdate': {
      recordsAt(variables, 'lines').forEach((patch) => {
        const id = stringAt(patch, 'id');
        const index = Number(id.split('/').pop()) - 1;
        const line = cartLines[index];
        assert.ok(line, `no line ${id}`);
        const updated = fakeLine({ ...line, ...patch }, id);
        if (updated.sellingPlanId === null) delete updated.sellingPlanId;
        cartLines[index] = updated;
      });
      return ok({ cartLinesUpdate: payload() });
    }
    case 'Tether_cartLinesRemove':
      cartLines = cartLines.filter((_, i) => !listAt(variables, 'lineIds').includes(`gid://shopify/CartLine/${i + 1}`));
      return ok({ cartLinesRemove: payload() });
    default:
      throw new Error(`unexpected op ${op}`);
  }
};

/**
 * @param {string} type
 * @returns A check that turns true once the document has sent `type` after this call.
 */
function sent(type) {
  let seen = false;
  document.addEventListener(
    type,
    () => {
      seen = true;
    },
    { once: true },
  );
  return () => seen;
}

/** Waits until every product scope on the page has loaded. */
const productsReady = () =>
  waitFor(
    () => findAll('[tether-product]').every((element) => element.getAttribute('tether-state') === 'ready'),
    'the products to load',
  );
/** @type {typeof import('../src/index.ts').default} */
let Tether;
/** @type {typeof Tether.plans} */
let plans;

before(async () => {
  ({ default: Tether } = await import('../src/index.ts'));
  plans = Tether.plans;
  await Tether.init({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    country: 'NL',
    locale: 'nl-NL',
    metafields: ['custom.origin'],
  });
});

beforeEach(() => {
  calls.length = 0;
});

// ---- pure helpers ----------------------------------------------------------

test('withContext adds @inContext to the operation', () => {
  const query = Tether.withContext('query A($id: ID!) { x }\nfragment F on Product { id }', {
    country: 'nl',
    language: 'nl',
  });
  assert.match(query, /^query A\(\$id: ID!\) @inContext\(country: NL, language: NL\) \{/);
});

test('selling plan helpers', () => {
  const [v250, v1kg] = product.variants.nodes;
  assert.equal(plans.allPlans(product).length, 2);
  assert.equal(plans.planPrice(v250, PLAN_MONTH)?.amount, '27');
  assert.deepEqual(plans.planSavings(v250, PLAN_MONTH)?.percentage, 10);
  assert.equal(plans.allocationFor(v1kg, PLAN_MONTH), null);
  assert.equal(plans.plansForVariant(product, v1kg).length, 1);
  assert.equal(plans.findPlan(product, 'every month')?.id, PLAN_MONTH);
  assert.equal(plans.findPlan(product, '2 months')?.id, PLAN_2MONTH);
  assert.equal(plans.findPlan(product, '111')?.id, PLAN_MONTH);
  assert.deepEqual(plans.planAdjustment(plans.allPlans(product)[0]), { type: 'percentage', value: 10 });
});

// ---- product scope ---------------------------------------------------------

function mountProduct(extra = '') {
  document.body.innerHTML = `
  <div tether-product="coffee-box" ${extra}>
    <h1 tether-bind="title">x</h1>
    <span tether-bind="metafield:custom.origin"></span>
    <span id="price" tether-bind="price"></span>
    <span id="sub-price" tether-bind="subscription-price"></span>
    <span id="savings" tether-bind="subscription-savings"></span>
    <span id="plan-name" tether-bind="plan-name"></span>
    <div tether-option-list="Size"><button>v</button></div>
    <button id="one" tether-purchase="one-time">Once</button>
    <button id="sub" tether-purchase="subscription">Subscribe</button>
    <div tether-plan-list="true"><button><span tether-plan-bind="name"></span> <span tether-plan-bind="price"></span></button></div>
    <div id="sub-only" tether-show="subscription-selected">sub</div>
    <input tether-line-attribute="Gift message" value="Hi!">
    <button id="add" tether-add-to-cart subscribe-text="x"><span tether-add-label>Add</span></button>
  </div>
  <div tether-cart-drawer>
    <span id="count" tether-cart-count></span>
    <div tether-cart-lines><div><span tether-line="title"></span><span class="plan" tether-line="plan"></span>
      <span class="sub" tether-line-show="subscription">S</span><button class="rm" tether-line-remove>x</button></div></div>
  </div>`;
  Tether.mount(document);
  return productsReady();
}

test('renders product, metafield and one-time price by default', async () => {
  await mountProduct();
  assert.equal(find('h1').textContent, 'Coffee Box');
  assert.equal(find('[tether-bind="metafield:custom.origin"]').textContent, 'Ethiopia');
  assert.match(find('#price').textContent, /30/);
  assert.match(find('#sub-price').textContent, /27/);
  assert.equal(find('#savings').textContent, '10%');
  assert.equal(find('#sub-only').style.display, 'none');
  assert.equal(document.querySelectorAll('[tether-plan-value]').length, 2);
  assert.equal(find('[tether-plan-value] [tether-plan-bind="name"]').textContent, 'Every month');
});

test('subscription toggle changes price and adds sellingPlanId to the cart line', async () => {
  localStorage.clear();
  cartLines = [];
  await mountProduct();
  find('#sub').click();
  assert.match(find('#price').textContent, /27/);
  assert.equal(find('#sub').getAttribute('aria-pressed'), 'true');
  assert.equal(find('#sub-only').style.display, '');
  assert.equal(find('#plan-name').textContent, 'Every month');

  const added = sent('tether:added');
  find('#add').click();
  await waitFor(added, 'the line to be added');
  const create = calls.find((call) => call.op === 'Tether_cartCreate');
  assert.ok(create, 'cartCreate called');
  const [line] = linesAt(recordAt(create.variables, 'input'), 'lines');
  assert.ok(line);
  assert.equal(line.merchandiseId, 'gid://shopify/ProductVariant/10');
  assert.equal(line.sellingPlanId, PLAN_MONTH);
  assert.deepEqual(line.attributes, [{ key: 'Gift message', value: 'Hi!' }]);
  assert.equal(recordAt(recordAt(create.variables, 'input'), 'buyerIdentity')['countryCode'], 'NL');
  assert.match(create.query, /@inContext\(country: NL\)/);

  assert.equal(find('#count').textContent, '1');
  assert.equal(find('.plan').textContent, 'Every month');
  assert.notEqual(find('.sub').style.display, 'none');
  assert.ok(find('[tether-cart-drawer]').classList.contains('is-open'));
});

test('picking a plan the variant lacks falls back to a plan it has', async () => {
  await mountProduct('tether-default-purchase="subscription"');
  const scope = Tether.getScope(document.querySelector('h1'));
  assert.ok(scope);
  assert.equal(scope.purchase.kind, 'subscription');
  scope.select('Size', '1kg');
  assert.deepEqual(scope.purchase, { kind: 'subscription', planId: PLAN_2MONTH });
  assert.equal(scope.getLine()?.sellingPlanId, PLAN_2MONTH);
});

test('one-time add has no sellingPlanId; lines can switch plan and be removed', async () => {
  localStorage.clear();
  cartLines = [];
  await mountProduct();
  find('#one').click();
  const added = sent('tether:added');
  find('#add').click();
  await waitFor(added, 'the line to be added');
  assert.equal(
    linesAt(recordAt(calls.find((call) => call.op === 'Tether_cartCreate')?.variables, 'input'), 'lines')[0]
      ?.sellingPlanId,
    undefined,
  );

  await Tether.cart.updateLine('gid://shopify/CartLine/1', { sellingPlanId: '111' });
  assert.equal(recordsAt(calls.at(-1)?.variables, 'lines')[0]?.['sellingPlanId'], PLAN_MONTH);
  assert.ok(Tether.cart.lines[0]?.sellingPlanAllocation);

  await Tether.cart.updateLine('gid://shopify/CartLine/1', { sellingPlanId: null });
  assert.equal(recordsAt(calls.at(-1)?.variables, 'lines')[0]?.['sellingPlanId'], null);

  find('.rm').click();
  await waitFor(() => Tether.cart.count === 0, 'the line to be removed');
  assert.equal(Tether.cart.count, 0);
});

test('group add sends all scopes in one request with _group attribute', async () => {
  localStorage.clear();
  cartLines = [];
  document.body.innerHTML = `
  <div tether-group="Starter set">
    <div tether-product="coffee-box"></div>
    <div tether-product="coffee-box" tether-default-purchase="subscription"></div>
    <button id="g" tether-group-add>Add set</button>
  </div>`;
  Tether.mount(document);
  await productsReady();
  const added = sent('tether:added');
  find('#g').click();
  await waitFor(added, 'the group to be added');
  const create = calls.filter((call) => call.op === 'Tether_cartCreate').at(-1);
  assert.ok(create);
  const lines = linesAt(recordAt(create.variables, 'input'), 'lines');
  assert.equal(lines.length, 2);
  assert.equal(lines[1]?.sellingPlanId, PLAN_MONTH);
  assert.deepEqual(lines[0]?.attributes, [{ key: '_group', value: 'Starter set' }]);
});

test('binds on the product root itself (card link)', async () => {
  document.body.innerHTML =
    '<a href="#" tether-product="coffee-box" tether-bind="link"><span tether-bind="title"></span></a>';
  Tether.mount(document);
  await productsReady();
  assert.equal(find('a').getAttribute('href'), '/product/coffee-box');
});

test('image:N binds the nth product image, background for non-img', async () => {
  document.body.innerHTML =
    '<div tether-product="coffee-box"><div id="bg" tether-bind="image:1"></div><img id="i9" tether-bind="image:9"></div>';
  Tether.mount(document);
  await productsReady();
  assert.match(find('#bg').style.backgroundImage, /a\.jpg/);
  assert.match(find('#i9').getAttribute('src') ?? '', /a\.jpg/);
});

test('a custom prefix reads its own attributes', async () => {
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, prefix: 'wfs' });
  document.body.innerHTML = '<div wfs-product="coffee-box"><h2 wfs-bind="title"></h2></div>';
  Tether.mount(document);
  await waitFor(() => find('h2').textContent === 'Coffee Box', 'the title in the custom prefix');
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false });
});

test("init removes the customer tokens 0.6's browser-mode accounts left in storage, and nothing else", async () => {
  const { sessionStorage: session, localStorage: local } = window;
  session.setItem('tether:account:shop.test', '{"refresh":"r"}');
  session.setItem('tether:account-login:shop.test', '{"verifier":"v"}');
  local.setItem('tether:account:shop.test', '{"refresh":"r"}');
  local.setItem('tether:account-hint:shop.test', '1');
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false });
  assert.equal(session.getItem('tether:account:shop.test'), null);
  assert.equal(session.getItem('tether:account-login:shop.test'), null);
  assert.equal(local.getItem('tether:account:shop.test'), null);
  assert.equal(local.getItem('tether:account-hint:shop.test'), '1', "the Worker login's hint stays");
  local.removeItem('tether:account-hint:shop.test');
});
