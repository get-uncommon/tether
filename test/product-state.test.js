// The server's initialState() and the browser scope derive their view in product-state.js, so they must agree; the
// purchase is one union, made valid against the product and variant in one place.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { apparel, find, findAll, jsonResponse, PLAN_2MONTH, PLAN_MONTH, product } from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://state.test/product/coffee-box' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window['Option'],
  getComputedStyle: dom.window.getComputedStyle,
});
const realFetch = globalThis.fetch;
globalThis.fetch = async () => jsonResponse({ data: { cart: null } });

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
/** @param {number} id */
const variantId = (id) => `gid://shopify/ProductVariant/${id}`;

/** @type {typeof import('../src/index.ts').default} */
let Tether;
/** @type {typeof import('../src/server.ts')} */
let server;
/** @type {typeof import('../src/product-state.ts')} */
let state;

before(async () => {
  ({ default: Tether } = await import('../src/index.ts'));
  server = await import('../src/server.ts');
  state = await import('../src/product-state.ts');
  await Tether.init({ domain: 'shop.test', token: 't', autoMount: false, country: 'NL', locale: LOCALE });
});
after(() => {
  globalThis.fetch = realFetch;
});

/** @type {import('../src/product-state.ts').Formatters} */
const RAW_FORMAT = { money: (money) => money?.amount ?? '', percent: String };

/**
 * @param {import('../src/fragments.ts').Product} item
 * @param {number} index
 * @returns {import('../src/fragments.ts').ProductVariant} The variant at `index`; the test fails when there is none.
 */
function variantAt(item, index) {
  const variant = item.variants.nodes[index];
  assert.ok(variant, `${item.handle} has a variant ${index}`);
  return variant;
}

/**
 * @param {import('../src/product-state.ts').ProductView | null} view
 * @returns {(name: string) => unknown} The text of a variant bind of `view`, written with `RAW_FORMAT`.
 */
function bindTexts(view) {
  assert.ok(view, 'the view is made');
  const texts = state.variantBindTexts(view, RAW_FORMAT);
  return (name) => {
    const text = texts.get(name);
    assert.ok(text, `a ${name} bind`);
    return text();
  };
}

/**
 * Mounts the product with every bind, condition, option and plan button initialState() describes.
 *
 * @param {import('../src/fragments.ts').Product} item
 * @param {{ attributes?: string, search?: string }} [options] The scope's own attributes, and the page URL's query.
 */
async function mountScope(item, { attributes = '', search = '' } = {}) {
  window.history.replaceState({}, '', `/product/${item.handle}${search}`);
  Tether.clearProductCache();
  Tether.primeProduct(item);
  const options = item.options
    .map((option) => `<div tether-option-list="${option.name}"><button></button></div>`)
    .join('');
  document.body.innerHTML = `<div tether-product="${item.handle}" ${attributes}>
    <span id="price" tether-bind="price"></span>
    <span id="compare" tether-bind="compare-at-price"></span>
    <span id="savings" tether-bind="subscription-savings"></span>
    ${SHOW_KEYS.map((key) => `<i data-key="${key}" tether-show="${key}"></i>`).join('')}
    ${options}
    <div tether-plan-list><button></button></div>
  </div>`;
  Tether.mount(document);
  await waitFor(
    () => document.querySelector('[tether-product]')?.getAttribute('tether-state') === 'ready',
    'the product scope to be ready',
  );
  window.history.replaceState({}, '', '/product/');
  const scope = Tether.getScope(document.querySelector('[tether-product]'));
  assert.ok(scope, 'the product has a scope');
  return scope;
}

/**
 * @type {{ name: string, product: import('../src/fragments.ts').Product, server: import('../src/server.ts').InitialOptions,
 *   browser: { attributes?: string, search?: string }, expected: Record<string, boolean | string | null> }[]}
 */
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
      variants: {
        nodes: product.variants.nodes.map((variant) => ({ ...variant, sellingPlanAllocations: { nodes: [] } })),
      },
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

for (const { name, product: item, server: options, browser, expected } of CASES) {
  test(`initialState() and the browser scope agree: ${name}`, async () => {
    const initial = server.initialState(item, options);
    const { plan, ...shown } = expected;
    if (plan !== undefined) assert.equal(initial.plan?.id ?? null, plan, 'the case sets up the plan it names');
    /** @type {Record<string, boolean>} */
    const shows = initial.show;
    for (const [key, value] of Object.entries(shown)) assert.equal(shows[key], value, `the case shows ${key}`);
    const scope = await mountScope(item, browser);

    assert.equal(scope.variant?.id, initial.variant.id, 'variant');
    assert.deepEqual({ ...scope.selected }, initial.selected, 'selected');
    assert.equal(scope.purchase.kind, initial.purchase, 'purchase');
    assert.equal(scope.isSubscription, initial.plan !== null, 'bought on a plan');
    if (initial.plan) assert.equal(scope.plan?.id, initial.plan.id, 'plan');

    assert.equal(find('#price').textContent, server.formatMoney(initial.price, LOCALE), 'price');
    const compare = initial.compareAtPrice ? server.formatMoney(initial.compareAtPrice, LOCALE) : '';
    assert.equal(find('#compare').textContent, compare, 'compare-at price');
    assert.equal(find('#savings').textContent, server.formatPercent(initial.savings, LOCALE), 'savings');

    for (const condition of findAll('[data-key]')) {
      const { key } = condition.dataset;
      assert.ok(key);
      assert.equal(typeof shows[key], 'boolean', `${key} is a boolean`);
      assert.equal(condition.style.display !== 'none', shows[key], key);
    }
    for (const option of item.options) {
      for (const button of document.querySelectorAll(`[tether-option-list="${option.name}"] [tether-option-value]`)) {
        const value = button.getAttribute('tether-option-value');
        assert.ok(value, 'an option button has a value');
        assert.equal(
          button.classList.contains('is-selected'),
          initial.selected[option.name] === value,
          `${value} selected`,
        );
        const unavailable = initial.isUnavailable(option.name, value);
        assert.equal(button.classList.contains('is-unavailable'), unavailable, `${value} unavailable`);
        assert.equal(initial.unavailable[option.name]?.includes(value), unavailable, `${value} in unavailable`);
      }
    }
    const planButtons = [...document.querySelectorAll('[tether-plan-value]')];
    assert.equal(planButtons.length, initial.plans.length, 'plan list');
    for (const plan of initial.plans) {
      const button = planButtons.find((element) => element.getAttribute('tether-plan-value') === plan.id);
      assert.ok(button, `${plan.name} has a button`);
      assert.equal(button.classList.contains('is-selected'), plan.selected, `${plan.name} selected`);
      assert.equal(button.classList.contains('is-unavailable'), !plan.available, `${plan.name} unavailable`);
    }
  });
}

test('initialState() keeps its shape: plain data plus isUnavailable()', () => {
  const initial = server.initialState(product);
  assert.deepEqual(Object.keys(initial).sort(), [
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
  assert.deepEqual(Object.keys(initial.show).sort(), [...SHOW_KEYS].sort());
  assert.deepEqual(Object.keys(initial.plans[0] ?? {}).sort(), [
    'available',
    'id',
    'name',
    'price',
    'savings',
    'selected',
  ]);
  assert.equal(server.initialState(null), null);
  assert.throws(() => server.initialState({ ...product, variants: { nodes: [] } }), /has no variants/);
});

test('purchase: a product without plans is bought once, whatever is wanted', () => {
  const tee = variantAt(apparel, 0);
  assert.deepEqual(state.normalisePurchase(apparel, tee, 'subscription', PLAN_MONTH), {
    kind: 'one-time',
    offeredPlanId: null,
  });
});

test('purchase: a product that requires a plan is always a subscription', () => {
  const required = { ...product, requiresSellingPlan: true };
  const small = variantAt(product, 0);
  assert.deepEqual(state.normalisePurchase(required, small, 'one-time', PLAN_2MONTH), {
    kind: 'subscription',
    planId: PLAN_2MONTH,
  });
});

test('purchase: the plan moves to one the variant is on, and an unknown plan to the first', () => {
  const small = variantAt(product, 0);
  const large = variantAt(product, 1);
  assert.deepEqual(state.normalisePurchase(product, large, 'subscription', PLAN_MONTH), {
    kind: 'subscription',
    planId: PLAN_2MONTH,
  });
  assert.deepEqual(state.normalisePurchase(product, small, 'one-time', 'gid://shopify/SellingPlan/9'), {
    kind: 'one-time',
    offeredPlanId: PLAN_MONTH,
  });
  // On no plan at all: the plan stays, for the subscription binds to offer.
  const onNoPlan = { ...small, sellingPlanAllocations: { nodes: [] } };
  assert.deepEqual(state.normalisePurchase(product, onNoPlan, 'subscription', PLAN_2MONTH), {
    kind: 'subscription',
    planId: PLAN_2MONTH,
  });
});

test('purchase: subscribing on a variant that is not on the plan buys the line once', () => {
  const small = variantAt(product, 0);
  const onNoPlan = { ...small, sellingPlanAllocations: { nodes: [] } };
  const withoutPlan = { ...product, variants: { nodes: [onNoPlan] } };
  const view = state.productView(
    withoutPlan,
    { selected: state.selectionOf(onNoPlan), purchase: { kind: 'subscription', planId: PLAN_MONTH }, quantity: 1 },
    5,
  );
  assert.ok(view, 'the view is made');
  assert.equal(view.purchase.kind, 'subscription', 'the choice is kept for a variant on the plan');
  assert.deepEqual(view.line, { kind: 'one-time' });
  assert.equal(view.show['subscription-selected'], false);
  assert.equal(view.show['one-time-selected'], true);
  assert.deepEqual(state.linePurchase({ kind: 'subscription', planId: PLAN_MONTH }, small), {
    kind: 'subscription',
    planId: PLAN_MONTH,
  });
});

test('purchase: the scope switches only to what the product allows', async () => {
  const tee = await mountScope(apparel);
  let changes = 0;
  tee.root.addEventListener('tether:variant-changed', () => {
    changes += 1;
  });
  tee.setPurchase('subscription');
  assert.deepEqual(tee.purchase, { kind: 'one-time', offeredPlanId: null });
  assert.equal(changes, 0, 'nothing changed, nothing rendered');

  const coffee = await mountScope(product);
  coffee.select('Size', '1kg');
  coffee.selectPlan(PLAN_MONTH);
  assert.deepEqual(coffee.purchase, { kind: 'subscription', planId: PLAN_2MONTH }, '1kg is only on the 2-month plan');
  assert.equal(coffee.getLine()?.sellingPlanId, PLAN_2MONTH);
  coffee.setPurchase('one-time');
  assert.deepEqual(coffee.purchase, { kind: 'one-time', offeredPlanId: PLAN_2MONTH }, 'the plan stays offered');
  assert.equal(coffee.isSubscription, false);
  const oneTimeLine = coffee.getLine();
  assert.ok(oneTimeLine, 'the scope has a line');
  assert.equal(oneTimeLine.sellingPlanId, undefined);
  coffee.selectPlan('gid://shopify/SellingPlan/9');
  assert.equal(coffee.purchase.kind, 'one-time', 'an unknown plan changes nothing');
});

test("money: amounts are computed in the currency's smallest unit, without float remainders", () => {
  const cheapVariant = {
    ...variantAt(apparel, 1),
    price: { amount: '0.1', currencyCode: 'EUR' },
    compareAtPrice: { amount: '0.4', currencyCode: 'EUR' },
  };
  const cheap = { ...apparel, variants: { nodes: [cheapVariant] } };
  const choice = state.initialChoice(cheap, {});
  const textOf = bindTexts(state.productView(cheap, { ...choice, quantity: 3 }, 5));
  assert.equal(textOf('discount-amount'), '0.30');
  assert.equal(textOf('total-price'), '0.30');
  assert.equal(textOf('discount-percentage'), '75%');

  const blue = variantAt(apparel, 1);
  const blueView = state.productView(
    apparel,
    { selected: state.selectionOf(blue), purchase: choice.purchase, quantity: 3 },
    5,
  );
  assert.equal(bindTexts(blueView)('total-price'), '59.97');
});

test('money: zero- and three-decimal currencies keep their own precision', () => {
  /**
   * @param {string} amount
   * @param {string} compareAt
   * @param {string} currencyCode
   */
  const priced = (amount, compareAt, currencyCode) => {
    const variant = {
      ...variantAt(apparel, 1),
      price: { amount, currencyCode },
      compareAtPrice: { amount: compareAt, currencyCode },
    };
    const item = { ...apparel, variants: { nodes: [variant] } };
    return bindTexts(state.productView(item, { ...state.initialChoice(item, {}), quantity: 3 }, 5));
  };
  const yen = priced('1500', '2000', 'JPY');
  assert.equal(yen('total-price'), '4500');
  assert.equal(yen('discount-amount'), '500');
  const dinar = priced('1.234', '2.001', 'KWD');
  assert.equal(dinar('total-price'), '3.702');
  assert.equal(dinar('discount-amount'), '0.767');
});
