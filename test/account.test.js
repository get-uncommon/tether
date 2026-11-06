import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://site.test/account' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  Option: dom.window.Option,
  getComputedStyle: dom.window.getComputedStyle,
});

const { configure } = await import('../src/config.js');
const { Cart } = await import('../src/cart.js');
const account = await import('../src/account.js');
const { forgetServerLogin, serverCheckoutUrl } = await import('../src/account/server-client.js');

const CART_KEY = 'tether:cart:shop.test';
const SERVER = { server: '/_tether/account' };
const reported = [];
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const visible = (id) => window.getComputedStyle(document.getElementById(id)).display !== 'none';
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
  const seen = [];
  const names = ['tether:account-login', 'tether:account-error'];
  const listener = (event) => seen.push({ name: event.type, detail: event.detail });
  names.forEach((name) => document.addEventListener(name, listener));
  try {
    await run();
  } finally {
    names.forEach((name) => document.removeEventListener(name, listener));
  }
  return seen;
}

/** The test configuration, to extend with an `account`. */
const testConfig = () => ({
  domain: 'shop.test',
  token: 't',
  autoMount: false,
  retries: 0,
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
  assert.match(reported[0].error.message, /Failed to fetch/);
  assert.ok(visible('out') && !visible('in'), 'the logged-out content is the fallback');
  assert.equal(document.getElementById('order').getAttribute('tether-order-state'), 'error');
  assert.ok(visible('order-error') && visible('addresses-error'), 'the pages show their error state');
});

test('a 401 is a logout, not a failure; a failing checkout link is left to the cart to report', async () => {
  configure({ ...testConfig(), account: SERVER });
  const answers = {
    '/me': () => json({ loggedIn: true, customer: { firstName: 'Ada' } }),
    '/orders': () => json({ loggedIn: false, orders: [] }, 401),
    '/cart': () => json({ error: 'Shopify is down' }, 502),
  };
  globalThis.fetch = async (url) => answers[new URL(url).pathname.replace('/_tether/account', '')]();
  assert.deepEqual(await account.orders(), []);
  assert.equal(reported.length, 0);
  localStorage.setItem(CART_KEY, 'gid://shopify/Cart/1');
  await assert.rejects(serverCheckoutUrl(), /Shopify is down/);
  assert.equal(reported.length, 0, 'the cart reports it, when checkout asks');
});

for (const [outcome, events] of [
  ['in', [{ name: 'tether:account-login', detail: {} }]],
  ['expired', [{ name: 'tether:account-error', detail: { error: 'expired' } }]],
  ['error', [{ name: 'tether:account-error', detail: { error: 'error' } }]],
]) {
  test(`?account=${outcome} from the Worker's login sends ${events[0].name}`, async () => {
    configure({ ...testConfig(), account: SERVER });
    globalThis.fetch = async () => json({ loggedIn: outcome === 'in', customer: { firstName: 'Ada' } });
    window.history.replaceState(null, '', `/account?account=${outcome}&page=2`);
    const fresh = await import(`../src/account.js?account-${outcome}`);
    assert.deepEqual(await eventsDuring(() => fresh.mountAccount(document)), events);
    assert.equal(window.location.search, '?page=2', 'the mark is dropped, the rest of the URL kept');
  });
}

test('another ?account= value is not the login redirect, and is left alone', async () => {
  configure({ ...testConfig(), account: SERVER });
  globalThis.fetch = async () => json({ loggedIn: false });
  window.history.replaceState(null, '', '/account?account=settings');
  const fresh = await import('../src/account.js?account-other');
  assert.deepEqual(await eventsDuring(() => fresh.mountAccount(document)), []);
  assert.equal(window.location.search, '?account=settings');
});

test('customer() reads the Worker’s /me into the public shape, the id included when the Worker sends it', async () => {
  configure({ ...testConfig(), account: SERVER });
  const { emailAddress, defaultAddress, ...names } = ADA;
  const me = { ...names, email: emailAddress.emailAddress, address: defaultAddress.formatted };
  globalThis.fetch = async () => json({ loggedIn: true, customer: me });
  const fromWorker = await account.customer();
  assert.deepEqual(fromWorker, ADA);
  forgetServerLogin();
  const { id, ...withoutId } = me;
  globalThis.fetch = async () => json({ loggedIn: true, customer: withoutId });
  assert.equal(id, ADA.id);
  assert.equal('id' in (await account.customer()), false, 'no id: left out, not null');
});

test('nobody logged in is customer() null and orders() empty, not an error', async () => {
  configure({ ...testConfig(), account: SERVER });
  globalThis.fetch = async () => json({ loggedIn: false }, 401);
  assert.equal(await account.customer(), null);
  assert.deepEqual(await account.orders(), []);
});

test('input the Worker or Shopify refuses is INVALID, with Shopify’s messages', async () => {
  configure({ ...testConfig(), account: SERVER });
  globalThis.fetch = async () =>
    json({ error: 'City is required', code: 'INVALID', userErrors: [{ message: 'City is required' }] }, 400);
  await assert.rejects(account.saveAddress({ address1: 'Main St 1' }), (error) => {
    assert.equal(error.code, 'INVALID');
    assert.deepEqual(
      error.userErrors.map((userError) => userError.message),
      ['City is required'],
    );
    return true;
  });
});

test('orders({ first }) takes a whole number from 1 to 50, checked before any request', async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return json({ orders: [] });
  };
  configure({ ...testConfig(), account: SERVER });
  for (const first of ['10&x=1', 0, 51, 2.5, Number.NaN]) {
    await assert.rejects(account.orders({ first }), { code: 'INVALID' }, String(first));
  }
  assert.deepEqual(asked, []);
  configure({ ...testConfig(), account: SERVER });
  await account.orders({ first: 50 });
  document.body.innerHTML = '<div tether-orders tether-limit="100"><a></a></div>';
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return new URL(url).pathname.endsWith('/me') ? json({ loggedIn: true, customer: ADA }) : json({ orders: [] });
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
    new URL(url).pathname.endsWith('/orders')
      ? json({ orders: [{ id: 'gid://shopify/Order/1', name: 7, lineItems: { nodes: [{ title: 'Tee' }] } }] })
      : json({ order: { name: '#1' } });
  const [first] = await account.orders();
  assert.equal(first.name, null);
  assert.equal(first.totalPrice, null);
  assert.deepEqual(first.lineItems.nodes, [{ title: 'Tee', variantTitle: null, quantity: 0, image: null }]);
  await assert.rejects(account.order(1), /the answer has no order id/);
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
  globalThis.fetch = async () => json({ loggedIn: true, customer: ADA });
  await account.render(document);
  assert.equal(account.isLoggedIn(), true);
  assert.deepEqual(Object.keys(localStorage), ['tether:account-hint:shop.test']);
  assert.equal(sessionStorage.length, 0);
  for (const removed of ['getToken', 'handleCallback', 'query']) assert.equal(account[removed], undefined, removed);
});
