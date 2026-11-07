// Checkout: the cart queue it waits in, the account's checkout URL and the cart's own.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  cancelTimersAfterTests,
  captureTetherWarnings,
  cartFrom,
  detailOf,
  graphqlRequest,
  jsonResponse,
  operationName,
  product,
} from './fixtures.js';
import { numberAt, recordAt, stringAt, waitFor, within } from '../server/test/mocks.js';

cancelTimersAfterTests();

// The failures these tests cause on purpose are checked through onError, states and events, not the console.
captureTetherWarnings();

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
});

const { configure } = await import('../src/config.ts');
const { Cart } = await import('../src/cart.ts');

const KEY = 'tether:cart:shop.test';
const VARIANT = product.variants.nodes[0]?.id ?? '';
/** @type {{ error: unknown, context: string }[]} */
const reported = [];
/** @typedef {ReturnType<typeof graphqlRequest>['variables']} Variables */
/** @type {{ op: string, variables: Variables }[]} */
const calls = [];
/** @type {Partial<Record<string, (variables: Variables) => unknown>>} op name -> response body, or a Promise of one */
let answers = {};

/**
 * @param {RequestInfo | URL} _url
 * @param {RequestInit} [init]
 */
globalThis.fetch = async (_url, init) => {
  const { query, variables } = graphqlRequest(init);
  const op = operationName(query);
  calls.push({ op, variables });
  const answer = answers[op];
  if (!answer) throw new Error(`unexpected op ${op}`);
  const body = await answer(variables);
  return body instanceof Response ? body : jsonResponse(body);
};

/**
 * @param {string} name
 * @param {import('../src/cart/store.ts').ShopifyCart | null} cart
 * @param {import('../src/client.ts').UserError[]} [userErrors]
 */
const payload = (name, cart, userErrors = []) => ({ data: { [name]: { cart, userErrors, warnings: [] } } });
const oneLine = (quantity = 1) => cartFrom([{ merchandiseId: VARIANT, quantity }]);
/**
 * Loads `cart` as the saved cart, the way a page with a cart starts.
 *
 * @param {import('../src/cart/store.ts').ShopifyCart | null} cart
 */
const loadSaved = async (cart) => {
  localStorage.setItem(KEY, 'gid://shopify/Cart/abc');
  answers['TetherCart'] = () => ({ data: { cart } });
  await Cart.init();
};
const deferred = () => {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

beforeEach(() => {
  configure({
    domain: 'shop.test',
    token: 't',
    autoMount: false,
    onError: (error, context) => reported.push({ error, context }),
  });
  localStorage.clear();
  reported.length = 0;
  calls.length = 0;
  answers = {};
  Cart.setCheckoutResolver(null);
  document.body.innerHTML = '';
});

test('checkout: a failing account step is reported and Shopify checkout is used instead', async () => {
  await loadSaved(oneLine());
  answers['TetherCheckout'] = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
  Cart.setCheckoutResolver(async () => {
    throw new Error('account server down');
  });
  /** @type {string[]} */
  const urls = [];
  document.addEventListener('tether:checkout', (event) => urls.push(stringAt(detailOf(event), 'url')), { once: true });
  const url = await Cart.checkout('_self');
  assert.equal(url, 'https://shop.test/checkouts/1');
  assert.deepEqual(urls, [url]);
  assert.deepEqual(
    reported.map((report) => report.context),
    ['account checkout'],
  );
});

test("checkout: the account's URL wins, and the cart's unneeded request failing is not a failure", async () => {
  await loadSaved(oneLine());
  answers['TetherCheckout'] = () => ({ errors: [{ message: 'Internal error' }] });
  Cart.setCheckoutResolver(async () => 'https://shop.test/checkouts/c/2?key=k');
  const url = await Cart.checkout('_self');
  assert.equal(url, 'https://shop.test/checkouts/c/2?key=k&logged_in=true');
  assert.equal(reported.length, 0);
});

test("checkout: null from the account uses the cart's URL, without the login parameter", async () => {
  await loadSaved(oneLine());
  answers['TetherCheckout'] = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
  Cart.setCheckoutResolver(async () => null);
  assert.equal(await Cart.checkout('_self'), 'https://shop.test/checkouts/1');
  Cart.setCheckoutResolver(null);
  assert.equal(await Cart.checkout('_self'), 'https://shop.test/checkouts/1', 'cleared: the cart decides');
  assert.equal(reported.length, 0);
});

test('checkout: a + clicked just before waits for Shopify, and checkout gets the updated cart', async () => {
  await loadSaved(oneLine(1));
  const update = deferred();
  /** @type {string[]} */
  const order = [];
  answers['Tether_cartLinesUpdate'] = async () => {
    await update.promise;
    order.push('update');
    return payload('cartLinesUpdate', oneLine(2));
  };
  answers['TetherCheckout'] = () => {
    order.push('checkout');
    return { data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } };
  };
  /** @type {number[]} */
  const counts = [];
  document.addEventListener(
    'tether:checkout',
    (event) => counts.push(numberAt(recordAt(detailOf(event), 'cart'), 'totalQuantity')),
    {
      once: true,
    },
  );
  const plus = Cart.changeQuantity('gid://shopify/CartLine/1', 1);
  const leaving = Cart.checkout('_self');
  await waitFor(() => calls.some((call) => call.op === 'Tether_cartLinesUpdate'), 'the + sent');
  assert.deepEqual(order, [], 'checkout waits while the + is on its way');
  update.resolve();
  assert.equal(await leaving, 'https://shop.test/checkouts/1');
  await plus;
  assert.deepEqual(order, ['update', 'checkout']);
  assert.deepEqual(counts, [2]);
});

test('checkout: an account resolver that changes the cart completes, and the cart keeps working', async () => {
  await loadSaved(oneLine());
  answers['Tether_cartAttributesUpdate'] = () => payload('cartAttributesUpdate', oneLine());
  answers['TetherCheckout'] = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
  Cart.setCheckoutResolver(async () => {
    await Cart.setAttributes({ source: 'checkout' });
    return null;
  });
  const url = await within(1000, Cart.checkout('_self'), 'the checkout');
  assert.equal(url, 'https://shop.test/checkouts/1');
  await within(1000, Cart.setAttributes({ source: 'later' }), 'a change after the checkout');
  assert.deepEqual(
    calls.map((call) => call.op).filter((op) => op === 'Tether_cartAttributesUpdate'),
    ['Tether_cartAttributesUpdate', 'Tether_cartAttributesUpdate'],
  );
  assert.equal(reported.length, 0);
});

test('checkout: a queued removal of the last line leaves nothing to check out', async () => {
  await loadSaved(oneLine(1));
  answers['Tether_cartLinesRemove'] = () => payload('cartLinesRemove', cartFrom([]));
  const removal = Cart.removeLine('gid://shopify/CartLine/1');
  assert.equal(await Cart.checkout('_self'), null);
  await removal;
  assert.equal(
    calls.some((call) => call.op === 'TetherCheckout'),
    false,
  );
  assert.equal(reported.length, 0);
});

for (const [start, saved] of /** @type {const} */ ([
  ['no cart yet', null],
  ['an empty saved cart', cartFrom([])],
])) {
  test(`checkout: with ${start}, an add called just before is checked out`, async () => {
    if (saved) await loadSaved(saved);
    else await Cart.init();
    answers['Tether_cartCreate'] = () => payload('cartCreate', oneLine(1));
    answers['Tether_cartLinesAdd'] = () => payload('cartLinesAdd', oneLine(1));
    answers['TetherCheckout'] = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
    const add = Cart.add(VARIANT);
    assert.equal(await Cart.checkout('_self'), 'https://shop.test/checkouts/1');
    await add;
    assert.equal(reported.length, 0);
  });
}

/**
 * Stands in for `window.open` while `run` runs: each tab is a jsdom window, whose navigation jsdom reports as not
 * implemented.
 *
 * @param {(tabs: { opened: number }) => Promise<void>} run Gets the counts so far.
 * @returns {Promise<{ opened: number, closed: number, navigated: number }>}
 */
async function withTabs(run) {
  const tabs = { opened: 0, closed: 0, navigated: 0 };
  const open = window.open.bind(window);
  const openTab = () => {
    tabs.opened++;
    const tabConsole = new VirtualConsole();
    tabConsole.on('jsdomError', (error) => {
      if (error.message.includes('navigation')) tabs.navigated++;
    });
    const tab = new JSDOM('', { url: 'https://site.test/', virtualConsole: tabConsole }).window;
    tab.close = () => {
      tabs.closed++;
    };
    return tab;
  };
  // A jsdom window isn't typed as the DOM's `Window`: it is assigned the way the setup above assigns the globals.
  Object.assign(window, { open: openTab });
  try {
    await run(tabs);
  } finally {
    Object.assign(window, { open });
  }
  return tabs;
}

for (const [start, saved] of /** @type {const} */ ([
  ['no cart yet', null],
  ['an empty saved cart', cartFrom([])],
])) {
  test(`checkout: with ${start} and a change that adds no line queued, _blank opens no tab`, async () => {
    if (saved) await loadSaved(saved);
    else await Cart.init();
    answers['Tether_cartCreate'] = () => payload('cartCreate', cartFrom([]));
    answers['Tether_cartNoteUpdate'] = () => payload('cartNoteUpdate', cartFrom([]));
    const tabs = await withTabs(async () => {
      const note = Cart.setNote('Gift');
      assert.equal(await Cart.checkout('_blank'), null);
      await note;
    });
    assert.deepEqual(tabs, { opened: 0, closed: 0, navigated: 0 });
    assert.equal(reported.length, 0);
  });

  test(`checkout: with ${start} and an add queued, _blank opens the tab inside the click`, async () => {
    if (saved) await loadSaved(saved);
    else await Cart.init();
    answers['Tether_cartCreate'] = () => payload('cartCreate', oneLine(1));
    answers['Tether_cartLinesAdd'] = () => payload('cartLinesAdd', oneLine(1));
    answers['TetherCheckout'] = () => ({ data: { cart: { checkoutUrl: 'https://shop.test/checkouts/1' } } });
    const tabs = await withTabs(async (tabsSoFar) => {
      const add = Cart.add(VARIANT);
      const checkout = Cart.checkout('_blank');
      assert.equal(tabsSoFar.opened, 1, 'opened before any await: Safari blocks window.open after one');
      assert.equal(await checkout, 'https://shop.test/checkouts/1');
      await add;
    });
    assert.deepEqual(tabs, { opened: 1, closed: 0, navigated: 1 }, 'the tab goes to checkout');
  });
}

test('checkout: without any checkout URL the failure is reported and nothing opens', async () => {
  await loadSaved(oneLine());
  answers['TetherCheckout'] = () => ({ errors: [{ message: 'Internal error' }] });
  assert.equal(await Cart.checkout('_self'), null);
  assert.deepEqual(
    reported.map((report) => report.context),
    ['checkout failed'],
  );
});
