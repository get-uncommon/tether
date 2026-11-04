import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { product, cartFrom, PLAN_MONTH, PLAN_2MONTH } from './fixtures.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/product/coffee-box' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver,
  Option: dom.window.Option, getComputedStyle: dom.window.getComputedStyle,
});

// ---- fake Storefront API ---------------------------------------------------
const calls = [];
let cartLines = [];
globalThis.fetch = async (url, init) => {
  const { query, variables } = JSON.parse(init.body);
  const op = query.match(/(?:query|mutation)\s+(\w+)/)[1];
  calls.push({ op, query, variables });
  const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
  const payload = () => ({ cart: cartFrom(cartLines), userErrors: [] });

  switch (op) {
    case 'TetherProducts': {
      const data = {};
      Object.keys(variables).forEach((k) => { if (k.startsWith('h')) data[k] = variables[k] === product.handle ? product : null; });
      return ok(data);
    }
    case 'TetherCart': return ok({ cart: cartLines.length ? cartFrom(cartLines) : null });
    case 'Tether_cartCreate': cartLines = [...variables.input.lines]; return ok({ cartCreate: payload() });
    case 'Tether_cartLinesAdd': cartLines = [...cartLines, ...variables.lines]; return ok({ cartLinesAdd: payload() });
    case 'Tether_cartLinesUpdate': {
      variables.lines.forEach((u) => {
        const i = Number(u.id.split('/').pop()) - 1;
        cartLines[i] = { ...cartLines[i], ...u };
        if (u.sellingPlanId === null) delete cartLines[i].sellingPlanId;
      });
      return ok({ cartLinesUpdate: payload() });
    }
    case 'Tether_cartLinesRemove':
      cartLines = cartLines.filter((_, i) => !variables.lineIds.includes(`gid://shopify/CartLine/${i + 1}`));
      return ok({ cartLinesRemove: payload() });
    default: throw new Error(`unexpected op ${op}`);
  }
};

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
let Tether;
let plans;

before(async () => {
  ({ default: Tether } = await import('../src/index.js'));
  plans = Tether.plans;
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', locale: 'nl-NL', metafields: ['custom.origin'] });
});

beforeEach(() => { calls.length = 0; });

// ---- pure helpers ----------------------------------------------------------

test('withContext adds @inContext to the operation', () => {
  const q = Tether.withContext('query A($id: ID!) { x }\nfragment F on Product { id }', { country: 'nl', language: 'nl' });
  assert.match(q, /^query A\(\$id: ID!\) @inContext\(country: NL, language: NL\) \{/);
});

test('selling plan helpers', () => {
  const [v250, v1kg] = product.variants.nodes;
  assert.equal(plans.allPlans(product).length, 2);
  assert.equal(plans.planPrice(v250, PLAN_MONTH).amount, '27');
  assert.deepEqual(plans.planSavings(v250, PLAN_MONTH).percentage, 10);
  assert.equal(plans.allocationFor(v1kg, PLAN_MONTH), null);
  assert.equal(plans.plansForVariant(product, v1kg).length, 1);
  assert.equal(plans.findPlan(product, 'every month').id, PLAN_MONTH);
  assert.equal(plans.findPlan(product, '2 months').id, PLAN_2MONTH);
  assert.equal(plans.findPlan(product, '111').id, PLAN_MONTH);
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
  return tick();
}

test('renders product, metafield and one-time price by default', async () => {
  await mountProduct();
  assert.equal(document.querySelector('h1').textContent, 'Coffee Box');
  assert.equal(document.querySelector('[tether-bind="metafield:custom.origin"]').textContent, 'Ethiopia');
  assert.match(document.querySelector('#price').textContent, /30/);
  assert.match(document.querySelector('#sub-price').textContent, /27/);
  assert.equal(document.querySelector('#savings').textContent, '10%');
  assert.equal(document.querySelector('#sub-only').style.display, 'none');
  assert.equal(document.querySelectorAll('[tether-plan-value]').length, 2);
  assert.equal(document.querySelector('[tether-plan-value] [tether-plan-bind="name"]').textContent, 'Every month');
});

test('subscription toggle changes price and adds sellingPlanId to the cart line', async () => {
  localStorage.clear(); cartLines = [];
  await mountProduct();
  document.querySelector('#sub').click();
  assert.match(document.querySelector('#price').textContent, /27/);
  assert.equal(document.querySelector('#sub').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#sub-only').style.display, '');
  assert.equal(document.querySelector('#plan-name').textContent, 'Every month');

  document.querySelector('#add').click();
  await tick(60);
  const create = calls.find((c) => c.op === 'Tether_cartCreate');
  assert.ok(create, 'cartCreate called');
  const line = create.variables.input.lines[0];
  assert.equal(line.merchandiseId, 'gid://shopify/ProductVariant/10');
  assert.equal(line.sellingPlanId, PLAN_MONTH);
  assert.deepEqual(line.attributes, [{ key: 'Gift message', value: 'Hi!' }]);
  assert.equal(create.variables.input.buyerIdentity.countryCode, 'NL');
  assert.match(create.query, /@inContext\(country: NL\)/);

  assert.equal(document.querySelector('#count').textContent, '1');
  assert.equal(document.querySelector('.plan').textContent, 'Every month');
  assert.notEqual(document.querySelector('.sub').style.display, 'none');
  assert.ok(document.querySelector('[tether-cart-drawer]').classList.contains('is-open'));
});

test('picking a plan the variant lacks falls back to a plan it has', async () => {
  await mountProduct('tether-default-purchase="subscription"');
  const scope = Tether.getScope(document.querySelector('h1'));
  assert.equal(scope.purchase, 'subscription');
  scope.select('Size', '1kg');
  assert.equal(scope.planId, PLAN_2MONTH);
  assert.equal(scope.getLine().sellingPlanId, PLAN_2MONTH);
});

test('one-time add has no sellingPlanId; lines can switch plan and be removed', async () => {
  localStorage.clear(); cartLines = [];
  await mountProduct();
  document.querySelector('#one').click();
  document.querySelector('#add').click();
  await tick(60);
  assert.equal(calls.find((c) => c.op === 'Tether_cartCreate').variables.input.lines[0].sellingPlanId, undefined);

  await Tether.cart.updateLine('gid://shopify/CartLine/1', { sellingPlanId: '111' });
  assert.equal(calls.at(-1).variables.lines[0].sellingPlanId, PLAN_MONTH);
  assert.ok(Tether.cart.lines[0].sellingPlanAllocation);

  await Tether.cart.updateLine('gid://shopify/CartLine/1', { sellingPlanId: null });
  assert.equal(calls.at(-1).variables.lines[0].sellingPlanId, null);

  document.querySelector('.rm').click();
  await tick(60);
  assert.equal(Tether.cart.count, 0);
});

test('group add sends all scopes in one request with _group attribute', async () => {
  localStorage.clear(); cartLines = [];
  document.body.innerHTML = `
  <div tether-group="Starter set">
    <div tether-product="coffee-box"></div>
    <div tether-product="coffee-box" tether-default-purchase="subscription"></div>
    <button id="g" tether-group-add>Add set</button>
  </div>`;
  Tether.mount(document);
  await tick();
  document.querySelector('#g').click();
  await tick(60);
  const create = calls.filter((c) => c.op === 'Tether_cartCreate').at(-1);
  assert.equal(create.variables.input.lines.length, 2);
  assert.equal(create.variables.input.lines[1].sellingPlanId, PLAN_MONTH);
  assert.deepEqual(create.variables.input.lines[0].attributes, [{ key: '_group', value: 'Starter set' }]);
});

test('binds on the product root itself (card link)', async () => {
  document.body.innerHTML = '<a href="#" tether-product="coffee-box" tether-bind="link"><span tether-bind="title"></span></a>';
  Tether.mount(document);
  await tick();
  assert.equal(document.querySelector('a').getAttribute('href'), '/product/coffee-box');
});

test('image:N binds the nth product image, background for non-img', async () => {
  document.body.innerHTML = '<div tether-product="coffee-box"><div id="bg" tether-bind="image:1"></div><img id="i9" tether-bind="image:9"></div>';
  Tether.mount(document);
  await tick();
  assert.match(document.querySelector('#bg').style.backgroundImage, /a\.jpg/);
  assert.match(document.querySelector('#i9').getAttribute('src'), /a\.jpg/);
});

test('custom prefix keeps old wfs- markup working', async () => {
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, prefix: 'wfs' });
  document.body.innerHTML = '<div wfs-product="coffee-box"><h2 wfs-bind="title"></h2></div>';
  Tether.mount(document);
  await tick();
  assert.equal(document.querySelector('h2').textContent, 'Coffee Box');
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false });
});
