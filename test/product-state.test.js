// The server's initialState() and the browser scope derive their view in product-state.js, so they must agree; the
// purchase is one union, made valid against the product and variant in one place.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { product, apparel, PLAN_MONTH, PLAN_2MONTH } from './fixtures.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://state.test/product/coffee-box' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window.Option,
  getComputedStyle: dom.window.getComputedStyle,
});
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: { cart: null } }) });

const SHOW_KEYS = [
  'in-stock',
  'out-of-stock',
  'backorder',
  'on-sale',
  'not-on-sale',
  'has-variants',
  'single-variant',
  'low-stock',
  'plenty-in-stock',
  'subscription-available',
  'subscription-unavailable',
  'subscription-only',
  'one-time-available',
  'subscription-selected',
  'one-time-selected',
  'has-savings',
];
const LOCALE = 'nl-NL';
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const variantId = (n) => `gid://shopify/ProductVariant/${n}`;

let Tether;
let server;
let state;

before(async () => {
  ({ default: Tether } = await import('../src/index.js'));
  server = await import('../src/server.js');
  state = await import('../src/product-state.js');
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', locale: LOCALE });
});
after(() => {
  globalThis.fetch = realFetch;
});

/** Mounts the product with every bind, condition, option and plan button initialState() describes. */
async function mountScope(p, { attributes = '', search = '' } = {}) {
  window.history.replaceState({}, '', `/product/${p.handle}${search}`);
  Tether.clearProductCache();
  Tether.primeProduct(p);
  const options = p.options
    .map((option) => `<div tether-option-list="${option.name}"><button></button></div>`)
    .join('');
  document.body.innerHTML = `<div tether-product="${p.handle}" ${attributes}>
    <span id="price" tether-bind="price"></span>
    <span id="compare" tether-bind="compare-at-price"></span>
    <span id="savings" tether-bind="subscription-savings"></span>
    ${SHOW_KEYS.map((key) => `<i data-key="${key}" tether-show="${key}"></i>`).join('')}
    ${options}
    <div tether-plan-list><button></button></div>
  </div>`;
  Tether.mount(document);
  await tick();
  window.history.replaceState({}, '', '/product/');
  return Tether.getScope(document.querySelector('[tether-product]'));
}

const CASES = [
  { name: 'one-time by default', product, server: {}, browser: {}, expected: { 'one-time-selected': true } },
  {
    name: 'subscription by default',
    product,
    server: { defaultPurchase: 'subscription' },
    browser: { attributes: 'tether-default-purchase="subscription"' },
    expected: { 'subscription-selected': true, 'has-savings': true, plan: PLAN_MONTH },
  },
  {
    name: 'a product that requires a plan',
    product: { ...product, requiresSellingPlan: true },
    server: {},
    browser: {},
    expected: { 'subscription-only': true, 'subscription-selected': true, plan: PLAN_MONTH },
  },
  {
    name: '?selling_plan= on a variant without that plan',
    product,
    server: { variant: '20', sellingPlan: PLAN_MONTH },
    browser: { attributes: 'tether-variant="20"', search: '?selling_plan=111' },
    expected: { 'subscription-selected': true, plan: PLAN_2MONTH },
  },
  {
    name: 'subscription wanted on a variant on no plan',
    product: {
      ...product,
      variants: { nodes: product.variants.nodes.map((v) => ({ ...v, sellingPlanAllocations: { nodes: [] } })) },
    },
    server: { defaultPurchase: 'subscription' },
    browser: { attributes: 'tether-default-purchase="subscription"' },
    expected: { 'subscription-unavailable': true, 'one-time-selected': true, plan: null },
  },
  {
    name: 'two options: first variant for sale, on sale and low in stock',
    product: apparel,
    server: {},
    browser: {},
    expected: { 'on-sale': true, 'low-stock': true, 'has-savings': true, 'subscription-unavailable': true },
  },
  {
    name: 'a variant on backorder',
    product: apparel,
    server: { variant: variantId(33) },
    browser: { attributes: `tether-variant="${variantId(33)}"` },
    expected: { backorder: true, 'plenty-in-stock': true },
  },
  {
    name: 'a sold-out variant',
    product: apparel,
    server: { variant: '31' },
    browser: { attributes: 'tether-variant="31"' },
    expected: { 'out-of-stock': true, 'plenty-in-stock': false },
  },
];

for (const { name, product: p, server: options, browser, expected } of CASES) {
  test(`initialState() and the browser scope agree: ${name}`, async () => {
    const st = server.initialState(p, options);
    const { plan, ...shown } = expected;
    if (plan !== undefined) assert.equal(st.plan?.id ?? null, plan, 'the case sets up the plan it names');
    for (const [key, value] of Object.entries(shown)) assert.equal(st.show[key], value, `the case shows ${key}`);
    const scope = await mountScope(p, browser);

    assert.equal(scope.variant.id, st.variant.id, 'variant');
    assert.deepEqual({ ...scope.selected }, st.selected, 'selected');
    assert.equal(scope.purchase, st.purchase, 'purchase');
    assert.equal(scope.isSubscription, st.plan !== null, 'bought on a plan');
    if (st.plan) assert.equal(scope.planId, st.plan.id, 'plan');

    assert.equal(document.getElementById('price').textContent, server.formatMoney(st.price, LOCALE), 'price');
    const compare = st.compareAtPrice ? server.formatMoney(st.compareAtPrice, LOCALE) : '';
    assert.equal(document.getElementById('compare').textContent, compare, 'compare-at price');
    assert.equal(document.getElementById('savings').textContent, server.formatPercent(st.savings, LOCALE), 'savings');

    for (const el of document.querySelectorAll('[data-key]')) {
      const { key } = el.dataset;
      assert.equal(typeof st.show[key], 'boolean', `${key} is a boolean`);
      assert.equal(el.style.display !== 'none', st.show[key], key);
    }
    for (const option of p.options) {
      for (const button of document.querySelectorAll(`[tether-option-list="${option.name}"] [tether-option-value]`)) {
        const value = button.getAttribute('tether-option-value');
        assert.equal(button.classList.contains('is-selected'), st.selected[option.name] === value, `${value} selected`);
        const unavailable = st.isUnavailable(option.name, value);
        assert.equal(button.classList.contains('is-unavailable'), unavailable, `${value} unavailable`);
        assert.equal(st.unavailable[option.name].includes(value), unavailable, `${value} in unavailable`);
      }
    }
    const planButtons = [...document.querySelectorAll('[tether-plan-value]')];
    assert.equal(planButtons.length, st.plans.length, 'plan list');
    for (const plan of st.plans) {
      const button = planButtons.find((el) => el.getAttribute('tether-plan-value') === plan.id);
      assert.equal(button.classList.contains('is-selected'), plan.selected, `${plan.name} selected`);
      assert.equal(button.classList.contains('is-unavailable'), !plan.available, `${plan.name} unavailable`);
    }
  });
}

test('initialState() keeps its shape: plain data plus isUnavailable()', () => {
  const st = server.initialState(product);
  assert.deepEqual(Object.keys(st).sort(), [
    'available',
    'compareAtPrice',
    'isUnavailable',
    'plan',
    'plans',
    'price',
    'purchase',
    'savings',
    'selected',
    'show',
    'unavailable',
    'variant',
  ]);
  assert.deepEqual(Object.keys(st.show).sort(), [...SHOW_KEYS].sort());
  assert.deepEqual(Object.keys(st.plans[0]).sort(), ['available', 'id', 'name', 'price', 'savings', 'selected']);
  assert.equal(server.initialState(null), null);
  assert.equal(server.initialState({ ...product, variants: { nodes: [] } }), null);
});

test('purchase: a product without plans is bought once, whatever is wanted', () => {
  const [tee] = apparel.variants.nodes;
  assert.deepEqual(state.normalisePurchase(apparel, tee, { kind: 'subscription', planId: PLAN_MONTH }), {
    kind: 'one-time',
    planId: null,
  });
});

test('purchase: a product that requires a plan is always a subscription', () => {
  const required = { ...product, requiresSellingPlan: true };
  const [small] = product.variants.nodes;
  assert.deepEqual(state.normalisePurchase(required, small, { kind: 'one-time', planId: PLAN_2MONTH }), {
    kind: 'subscription',
    planId: PLAN_2MONTH,
  });
});

test('purchase: the plan moves to one the variant is on, and an unknown plan to the first', () => {
  const [small, large] = product.variants.nodes;
  assert.deepEqual(state.normalisePurchase(product, large, { kind: 'subscription', planId: PLAN_MONTH }), {
    kind: 'subscription',
    planId: PLAN_2MONTH,
  });
  assert.deepEqual(
    state.normalisePurchase(product, small, { kind: 'one-time', planId: 'gid://shopify/SellingPlan/9' }),
    {
      kind: 'one-time',
      planId: PLAN_MONTH,
    },
  );
  // On no plan at all: the plan stays, for the subscription binds to offer.
  const onNoPlan = { ...small, sellingPlanAllocations: { nodes: [] } };
  assert.deepEqual(state.normalisePurchase(product, onNoPlan, { kind: 'subscription', planId: PLAN_2MONTH }), {
    kind: 'subscription',
    planId: PLAN_2MONTH,
  });
});

test('purchase: the scope switches only to what the product allows, and keeps legacy fields in step', async () => {
  const tee = await mountScope(apparel);
  let changes = 0;
  tee.root.addEventListener('tether:variant-changed', () => {
    changes += 1;
  });
  tee.setPurchase('subscription');
  assert.equal(tee.purchase, 'one-time');
  assert.equal(tee.planId, null);
  assert.equal(changes, 0, 'nothing changed, nothing rendered');

  const coffee = await mountScope(product);
  coffee.select('Size', '1kg');
  coffee.selectPlan(PLAN_MONTH);
  assert.equal(coffee.purchase, 'subscription');
  assert.equal(coffee.planId, PLAN_2MONTH, '1kg is only on the 2-month plan');
  assert.equal(coffee.getLine().sellingPlanId, PLAN_2MONTH);
  coffee.purchase = 'one-time';
  assert.equal(coffee.isSubscription, false);
  assert.equal(coffee.getLine().sellingPlanId, undefined);
  coffee.planId = 'gid://shopify/SellingPlan/9';
  assert.equal(coffee.planId, PLAN_2MONTH, 'an unknown plan becomes one the variant is on');
});

test('money: amounts are computed in hundredths, without float remainders', () => {
  const format = { money: (money) => money?.amount ?? '', percent: String };
  const cheap = {
    ...apparel,
    variants: {
      nodes: [{ ...apparel.variants.nodes[1], price: { amount: '0.1', currencyCode: 'EUR' } }],
    },
  };
  cheap.variants.nodes[0].compareAtPrice = { amount: '0.4', currencyCode: 'EUR' };
  const choice = state.initialChoice(cheap, {});
  const view = state.productView(cheap, { ...choice, quantity: 3 }, 5);
  const texts = state.variantBindTexts(view, format);
  assert.equal(texts.get('discount-amount')(), '0.30');
  assert.equal(texts.get('total-price')(), '0.30');
  assert.equal(texts.get('discount-percentage')(), '75%');

  const [, blue] = apparel.variants.nodes;
  const blueView = state.productView(
    apparel,
    { selected: state.selectionOf(blue), purchase: choice.purchase, quantity: 3 },
    5,
  );
  assert.equal(state.variantBindTexts(blueView, format).get('total-price')(), '59.97');
});
