import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { detailOf, find, jsonResponse, pageGlobals } from './fixtures.js';
import { urlOf } from '../server/test/mocks.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/account' });
Object.assign(globalThis, { ...pageGlobals(dom.window), sessionStorage: dom.window.sessionStorage });

const { configure } = await import('../src/config.ts');
const { Cart } = await import('../src/cart.ts');
const account = await import('../src/account.ts');
const { forgetServerLogin, serverCheckoutUrl } = await import('../src/account/server-client.ts');
const { TetherError } = await import('../src/client.ts');

const CART_KEY = 'tether:cart:shop.test';
const SERVER = { server: '/_tether/account' };
/** @type {{ error: unknown, context: string }[]} */
const reported = [];
/** @param {string} id */
const visible = (id) => window.getComputedStyle(find(`#${id}`)).display !== 'none';
const ADA = {
  id: 'gid://shopify/Customer/1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  displayName: 'Ada Lovelace',
  emailAddress: { emailAddress: 'ada@x.test' },
  defaultAddress: { formatted: ['Street 1', 'Utrecht'] },
};

/**
 * The account events sent on `document` while `run` runs.
 *
 * @param {() => Promise<unknown>} run
 */
async function eventsDuring(run) {
  /** @type {{ name: string, detail: unknown }[]} */
  const seen = [];
  const names = ['tether:account-login', 'tether:account-error'];
  /** @param {Event} event */
  const listener = (event) => seen.push({ name: event.type, detail: detailOf(event) });
  names.forEach((name) => {
    document.addEventListener(name, listener);
  });
  try {
    await run();
  } finally {
    names.forEach((name) => {
      document.removeEventListener(name, listener);
    });
  }
  return seen;
}

/** The test configuration, to extend with an `account`. */
const testConfig = () => ({
  domain: 'shop.test',
  token: 't',
  autoMount: false,
  retries: 0,
  /**
   * @param {unknown} error
   * @param {string} context
   */
  onError: (error, context) => reported.push({ error, context }),
});

beforeEach(() => {
  configure(testConfig());
  localStorage.clear();
  sessionStorage.clear();
  reported.length = 0;
  Cart.setCheckoutResolver(null);
  document.body.innerHTML = '';
  forgetServerLogin();
  window.history.replaceState(null, '', '/account');
});

test('a Worker outage is reported, not shown as a logout without a word', async () => {
  configure({ ...testConfig(), account: SERVER });
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  document.body.innerHTML = `
    <p id="in" tether-show="logged-in">Hi</p><p id="out" tether-show="logged-out">Log in</p>
    <section id="order" tether-order="7"><p id="order-error" tether-order-show="error" hidden>Not available</p></section>
    <p id="addresses-error" tether-show="addresses-error" hidden></p><ul tether-addresses><li></li></ul>`;
  await account.render(document);
  assert.deepEqual(
    reported.map((entry) => entry.context),
    ['account'],
  );
  const [failure] = reported;
  assert.ok(failure?.error instanceof Error);
  assert.match(failure.error.message, /Failed to fetch/);
  assert.ok(visible('out') && !visible('in'), 'the logged-out content is the fallback');
  assert.equal(find('#order').getAttribute('tether-order-state'), 'error');
  assert.ok(visible('order-error') && visible('addresses-error'), 'the pages show their error state');
});

test('a 401 is a logout, not a failure; a failing checkout link is left to the cart to report', async () => {
  configure({ ...testConfig(), account: SERVER });
  /** @type {Record<string, () => Response>} */
  const answers = {
    '/me': () => jsonResponse({ loggedIn: true, customer: { firstName: 'Ada' } }),
    '/orders': () => jsonResponse({ loggedIn: false, orders: [] }, 401),
    '/cart': () => jsonResponse({ error: 'Shopify is down' }, 502),
  };
  globalThis.fetch = async (url) => {
    const answer = answers[new URL(urlOf(url)).pathname.replace('/_tether/account', '')];
    assert.ok(answer, `no answer for ${urlOf(url)}`);
    return answer();
  };
  assert.deepEqual(await account.orders(), []);
  assert.equal(reported.length, 0);
  localStorage.setItem(CART_KEY, 'gid://shopify/Cart/1');
  await assert.rejects(serverCheckoutUrl(), /Shopify is down/);
  assert.equal(reported.length, 0, 'the cart reports it, when checkout asks');
});

/** @type {[string, { name: string; detail: object }[]][]} */
const LOGIN_OUTCOMES = [
  ['in', [{ name: 'tether:account-login', detail: {} }]],
  ['expired', [{ name: 'tether:account-error', detail: { error: 'expired' } }]],
  ['error', [{ name: 'tether:account-error', detail: { error: 'error' } }]],
];

/**
 * A fresh instance of the account module, which reads the URL's login mark when it loads.
 *
 * @param {string} instance
 * @returns {Promise<typeof import('../src/account.ts')>}
 */
const freshAccount = (instance) => import(`../src/account.ts?account-${instance}`);

for (const [outcome, events] of LOGIN_OUTCOMES) {
  test(`?account=${outcome} from the Worker's login sends ${events[0]?.name}`, async () => {
    configure({ ...testConfig(), account: SERVER });
    globalThis.fetch = async () => jsonResponse({ loggedIn: outcome === 'in', customer: { firstName: 'Ada' } });
    window.history.replaceState(null, '', `/account?account=${outcome}&page=2`);
    const fresh = await freshAccount(outcome);
    assert.deepEqual(await eventsDuring(() => fresh.mountAccount(document)), events);
    assert.equal(window.location.search, '?page=2', 'the mark is dropped, the rest of the URL kept');
  });
}

test('another ?account= value is not the login redirect, and is left alone', async () => {
  configure({ ...testConfig(), account: SERVER });
  globalThis.fetch = async () => jsonResponse({ loggedIn: false });
  window.history.replaceState(null, '', '/account?account=settings');
  const fresh = await freshAccount('other');
  assert.deepEqual(await eventsDuring(() => fresh.mountAccount(document)), []);
  assert.equal(window.location.search, '?account=settings');
});

test('customer() reads the Worker’s /me into the public shape, the id included when the Worker sends it', async () => {
  configure({ ...testConfig(), account: SERVER });
  const { emailAddress, defaultAddress, ...names } = ADA;
  const me = { ...names, email: emailAddress.emailAddress, address: defaultAddress.formatted };
  globalThis.fetch = async () => jsonResponse({ loggedIn: true, customer: me });
  const fromWorker = await account.customer();
  assert.deepEqual(fromWorker, ADA);
  forgetServerLogin();
  const { id, ...withoutId } = me;
  globalThis.fetch = async () => jsonResponse({ loggedIn: true, customer: withoutId });
  assert.equal(id, ADA.id);
  const withoutIdAnswer = await account.customer();
  assert.ok(withoutIdAnswer);
  assert.equal('id' in withoutIdAnswer, false, 'no id: left out, not null');
});

test('nobody logged in is customer() null and orders() empty, not an error', async () => {
  configure({ ...testConfig(), account: SERVER });
  globalThis.fetch = async () => jsonResponse({ loggedIn: false }, 401);
  assert.equal(await account.customer(), null);
  assert.deepEqual(await account.orders(), []);
});

test('input the Worker or Shopify refuses is INVALID, with Shopify’s messages', async () => {
  configure({ ...testConfig(), account: SERVER });
  globalThis.fetch = async () =>
    jsonResponse({ error: 'City is required', code: 'INVALID', userErrors: [{ message: 'City is required' }] }, 400);
  await assert.rejects(account.saveAddress({ address1: 'Main St 1' }), (error) => {
    assert.ok(error instanceof TetherError);
    assert.equal(error.code, 'INVALID');
    assert.deepEqual(
      error.userErrors?.map((userError) => userError.message),
      ['City is required'],
    );
    return true;
  });
});

test('orders({ first }) takes a whole number from 1 to 50, checked before any request', async () => {
  /** @type {string[]} */
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(urlOf(url));
    return jsonResponse({ orders: [] });
  };
  configure({ ...testConfig(), account: SERVER });
  for (const first of ['10&x=1', 0, 51, 2.5, Number.NaN]) {
    // @ts-expect-error -- a site's script can pass anything; orders() checks it
    await assert.rejects(account.orders({ first }), { code: 'INVALID' }, String(first));
  }
  assert.equal(asked.length, 0);
  configure({ ...testConfig(), account: SERVER });
  await account.orders({ first: 50 });
  document.body.innerHTML = '<div tether-orders tether-limit="100"><a></a></div>';
  globalThis.fetch = async (url) => {
    asked.push(urlOf(url));
    return new URL(urlOf(url)).pathname.endsWith('/me')
      ? jsonResponse({ loggedIn: true, customer: ADA })
      : jsonResponse({ orders: [] });
  };
  await account.render(document);
  assert.deepEqual(
    asked.filter((url) => url.includes('/orders')).map((url) => new URL(url).search),
    ['?first=50', '?first=50'],
    'a tether-limit above 50 asks for 50',
  );
});

test('an answer without the ids the page acts on is an error, other fields read as null', async () => {
  configure({ ...testConfig(), account: SERVER });
  globalThis.fetch = async (url) =>
    new URL(urlOf(url)).pathname.endsWith('/orders')
      ? jsonResponse({ orders: [{ id: 'gid://shopify/Order/1', name: 7, lineItems: { nodes: [{ title: 'Tee' }] } }] })
      : jsonResponse({ order: { name: '#1' } });
  const [first] = await account.orders();
  assert.ok(first, 'the order is read');
  assert.equal(first.name, null);
  assert.equal(first.totalPrice, null);
  assert.deepEqual(first.lineItems.nodes, [{ title: 'Tee', variantTitle: null, quantity: 0, image: null }]);
  await assert.rejects(account.order(1), /the answer has no order id/);
});

test('a /me answered after a logout does not log the customer back in, and calls at once share one /me', async () => {
  configure({ ...testConfig(), account: SERVER });
  document.body.innerHTML = '<p id="in" tether-show="logged-in">Hi</p>';
  /** @type {string[]} */
  const sent = [];
  let sessionAlive = true;
  /** @type {((value: unknown) => void)[]} */
  const answerLater = [];
  globalThis.fetch = async (url) => {
    const path = new URL(urlOf(url)).pathname.replace('/_tether/account', '');
    sent.push(path);
    if (path === '/logout') {
      sessionAlive = false;
      return jsonResponse({ loggedOut: true, logoutUrl: null });
    }
    // The answer goes by the session cookie the request carried.
    const body = sessionAlive ? { loggedIn: true, customer: ADA } : { loggedIn: false };
    if (sessionAlive) await new Promise((resolve) => answerLater.push(resolve));
    return jsonResponse(body);
  };
  const mounted = Promise.all([account.render(document), account.customer()]);
  await new Promise(setImmediate);
  assert.deepEqual(sent, ['/me']);
  await account.logout();
  answerLater.forEach((answer) => {
    answer(undefined);
  });
  await mounted;
  assert.deepEqual(sent, ['/me', '/logout', '/me']);
  assert.equal(account.isLoggedIn(), false);
  assert.equal(localStorage.getItem('tether:account-hint:shop.test'), null);
  assert.equal(visible('in'), false);
});

test('without account.server every account function rejects with NOT_CONFIGURED, before any request', async () => {
  globalThis.fetch = async () => {
    throw new Error('no request expected');
  };
  for (const call of [
    () => account.login(),
    () => account.customer(),
    () => account.orders(),
    () => account.logout(),
  ]) {
    await assert.rejects(call(), { code: 'NOT_CONFIGURED', message: /set account\.server/ });
  }
  assert.equal(account.isLoggedIn(), false);
});

test('the part keeps no token in the browser, only the hint that a customer may be logged in', async () => {
  configure({ ...testConfig(), account: SERVER });
  globalThis.fetch = async () => jsonResponse({ loggedIn: true, customer: ADA });
  await account.render(document);
  assert.equal(account.isLoggedIn(), true);
  assert.deepEqual(Object.keys(localStorage), ['tether:account-hint:shop.test']);
  assert.equal(sessionStorage.length, 0);
  for (const removed of ['getToken', 'handleCallback', 'query'])
    assert.equal(Reflect.get(account, removed), undefined, removed);
});
