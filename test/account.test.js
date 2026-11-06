// The account part on its own: outages, the logout's privacy step, the documents it shares with the Worker.
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
const { CUSTOMER_QUERY, ORDERS_QUERY } = await import('../server/src/shared/account-documents.js');

const CART_KEY = 'tether:cart:shop.test';
const SESSION_KEY = 'tether:account:shop.test';
const GRAPHQL = 'https://shopify.com/1/account/customer/api/2026-10/graphql';
const reported = [];
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const visible = (id) => window.getComputedStyle(document.getElementById(id)).display !== 'none';

/** The shop's `.well-known` documents, for browser mode. */
function discovery(url) {
  if (url.endsWith('/.well-known/openid-configuration')) {
    return json({
      issuer: 'https://shopify.com/authentication/1',
      authorization_endpoint: 'https://shopify.com/authentication/1/oauth/authorize',
      token_endpoint: 'https://shopify.com/authentication/1/oauth/token',
      end_session_endpoint: 'https://shopify.com/authentication/1/logout',
    });
  }
  if (url.endsWith('/.well-known/customer-account-api')) return json({ graphql_api: GRAPHQL });
  return null;
}

/** A browser-mode session as the part stores it, valid for an hour. */
function storeSession(session = {}) {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ access: 'tok-1', expiresAt: Date.now() + 3600_000, refresh: null, idToken: null, ...session }),
  );
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
  Cart.setCustomer({ accessToken: null, beforeCheckout: null });
  document.body.innerHTML = '';
});

test('server mode: a Worker outage is reported, not shown as a logout without a word', async () => {
  configure({ ...testConfig(), account: { server: '/_tether/account' } });
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

test('server mode: a 401 is a logout, not a failure; a failing checkout link is left to the cart to report', async () => {
  configure({ ...testConfig(), account: { server: '/_tether/account' } });
  const answers = {
    '/me': () => json({ loggedIn: true, customer: { firstName: 'Ada' } }),
    '/orders': () => json({ loggedIn: false, orders: [] }, 401),
    '/cart': () => json({ error: 'Shopify is down' }, 502),
  };
  globalThis.fetch = async (url) => answers[new URL(url).pathname.replace('/_tether/account', '')]();
  assert.deepEqual(await account.orders(), []);
  assert.equal(reported.length, 0);
  localStorage.setItem(CART_KEY, 'gid://shopify/Cart/1');
  await account.mountAccount(document);
  await assert.rejects(Cart.beforeCheckout(), /Shopify is down/);
});

test('browser mode: when Shopify is not told about the logout, the cart is forgotten here', async () => {
  configure({ ...testConfig(), account: { clientId: 'client-1' } });
  storeSession();
  localStorage.setItem(CART_KEY, 'gid://shopify/Cart/1');
  const sent = [];
  globalThis.fetch = async (url) => {
    sent.push(String(url));
    if (String(url).startsWith('https://shop.test/api/')) throw new TypeError('Failed to fetch');
    return discovery(String(url)) ?? json({}, 404);
  };
  const loggedOut = [];
  document.addEventListener('tether:account-logout', () => loggedOut.push(true), { once: true });
  await account.logout();
  assert.ok(
    sent.some((url) => url.startsWith('https://shop.test/api/')),
    'the unlink was tried',
  );
  assert.deepEqual(
    reported.map((entry) => entry.context),
    ['account cart unlink'],
  );
  assert.equal(localStorage.getItem(CART_KEY), null, 'the next visitor does not check out as this customer');
  assert.equal(Cart.customerAccessToken, null);
  assert.equal(sessionStorage.getItem(SESSION_KEY), null);
  assert.deepEqual(loggedOut, [true]);
});

test('browser mode: a stored session of another shape is not a login', async () => {
  configure({ ...testConfig(), account: { clientId: 'client-1' } });
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ access: 42, expiresAt: 'soon' }));
  globalThis.fetch = async () => {
    throw new Error('no request expected');
  };
  assert.equal(await account.getToken(), null);
  assert.equal(account.isLoggedIn(), false);
});

// Runs last: it leaves a session in memory.
test('browser mode: customer() and orders() send the documents the Worker uses', async () => {
  configure({ ...testConfig(), account: { clientId: 'client-1' } });
  storeSession();
  const queries = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) !== GRAPHQL) return discovery(String(url)) ?? json({}, 404);
    assert.equal(init.headers.Authorization, 'tok-1');
    const { query, variables } = JSON.parse(init.body);
    queries.push({ query, variables });
    if (query === CUSTOMER_QUERY) return json({ data: { customer: { id: 'c1', firstName: 'Ada' } } });
    return json({ data: { customer: { orders: { nodes: [{ id: 'o1', name: '#1001', lineItems: { nodes: [] } }] } } } });
  };
  assert.equal((await account.customer()).firstName, 'Ada');
  assert.deepEqual(
    (await account.orders({ first: 3 })).map((order) => order.name),
    ['#1001'],
  );
  assert.deepEqual(queries, [
    { query: CUSTOMER_QUERY, variables: {} },
    { query: ORDERS_QUERY, variables: { first: 3 } },
  ]);
});
