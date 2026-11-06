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
const { forgetServerLogin } = await import('../src/account/server-client.js');
const { forgetBrowserCustomer } = await import('../src/account/browser-session.js');
const { CUSTOMER_QUERY, ORDERS_QUERY } = await import('../server/src/shared/account-documents.js');

const CART_KEY = 'tether:cart:shop.test';
const SESSION_KEY = 'tether:account:shop.test';
const GRAPHQL = 'https://shopify.com/1/account/customer/api/2026-10/graphql';
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

/** The shop's `.well-known` documents, for browser mode. */
function discovery(url) {
  if (url.endsWith('/.well-known/openid-configuration')) {
    return json({
      issuer: 'https://shopify.com/authentication/1',
      authorization_endpoint: 'https://shopify.com/authentication/1/oauth/authorize',
      token_endpoint: 'https://shopify.com/authentication/1/oauth/token',
      end_session_endpoint: 'https://shopify.com/authentication/1/logout',
      jwks_uri: 'https://shopify.com/authentication/1/.well-known/jwks.json',
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
  forgetServerLogin();
  forgetBrowserCustomer();
  window.history.replaceState(null, '', '/account');
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

for (const [outcome, events] of [
  ['in', [{ name: 'tether:account-login', detail: {} }]],
  ['expired', [{ name: 'tether:account-error', detail: { error: 'expired' } }]],
  ['error', [{ name: 'tether:account-error', detail: { error: 'error' } }]],
]) {
  test(`server mode: ?account=${outcome} from the Worker's login sends ${events[0].name}`, async () => {
    configure({ ...testConfig(), account: { server: '/_tether/account' } });
    globalThis.fetch = async () => json({ loggedIn: outcome === 'in', customer: { firstName: 'Ada' } });
    window.history.replaceState(null, '', `/account?account=${outcome}&page=2`);
    const fresh = await import(`../src/account.js?account-${outcome}`);
    assert.deepEqual(await eventsDuring(() => fresh.mountAccount(document)), events);
    assert.equal(window.location.search, '?page=2', 'the mark is dropped, the rest of the URL kept');
  });
}

test('server mode: another ?account= value is not the login redirect, and is left alone', async () => {
  configure({ ...testConfig(), account: { server: '/_tether/account' } });
  globalThis.fetch = async () => json({ loggedIn: false });
  window.history.replaceState(null, '', '/account?account=settings');
  const fresh = await import('../src/account.js?account-other');
  assert.deepEqual(await eventsDuring(() => fresh.mountAccount(document)), []);
  assert.equal(window.location.search, '?account=settings');
});

test('both modes: customer() has one shape, the id included when the Worker sends it', async () => {
  configure({ ...testConfig(), account: { server: '/_tether/account' } });
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

  configure({ ...testConfig(), account: { clientId: 'client-1' } });
  storeSession();
  globalThis.fetch = async (url) => discovery(String(url)) ?? json({ data: { customer: ADA } });
  assert.deepEqual(await account.customer(), fromWorker);
  await account.logout();
});

test('both modes: nobody logged in is customer() null and orders() empty, not an error', async () => {
  configure({ ...testConfig(), account: { clientId: 'client-1' } });
  globalThis.fetch = async () => {
    throw new Error('no request expected');
  };
  assert.equal(await account.customer(), null);
  assert.deepEqual(await account.orders(), []);
  configure({ ...testConfig(), account: { server: '/_tether/account' } });
  globalThis.fetch = async () => json({ loggedIn: false }, 401);
  assert.equal(await account.customer(), null);
  assert.deepEqual(await account.orders(), []);
});

test('both modes: input Shopify or the operation refuses is INVALID', async () => {
  configure({ ...testConfig(), account: { server: '/_tether/account' } });
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
  configure({ ...testConfig(), account: { clientId: 'client-1' } });
  globalThis.fetch = async () => {
    throw new Error('refused before any request');
  };
  await assert.rejects(account.saveAddress('not an address'), { code: 'INVALID' });
});

test('both modes: orders({ first }) takes a whole number from 1 to 50, checked before any request', async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return json({ orders: [] });
  };
  for (const accountConfig of [{ server: '/_tether/account' }, { clientId: 'client-1' }]) {
    configure({ ...testConfig(), account: accountConfig });
    for (const first of ['10&x=1', 0, 51, 2.5, Number.NaN]) {
      await assert.rejects(account.orders({ first }), { code: 'INVALID' }, String(first));
    }
  }
  assert.deepEqual(asked, []);
  configure({ ...testConfig(), account: { server: '/_tether/account' } });
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

test('server mode: an answer without the ids the page acts on is an error, other fields read as null', async () => {
  configure({ ...testConfig(), account: { server: '/_tether/account' } });
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

test('browser mode: a stored session is a login before any request', async () => {
  configure({ ...testConfig(), account: { clientId: 'client-1' } });
  storeSession();
  assert.equal(account.isLoggedIn(), true);
});

test('browser mode: a token Shopify refuses and that cannot be refreshed ends the login', async () => {
  configure({ ...testConfig(), account: { clientId: 'client-1' } });
  storeSession({ refresh: 'refresh-1' });
  const authorizations = [];
  globalThis.fetch = async (url, init) => {
    const known = discovery(String(url));
    if (known) return known;
    if (String(url).endsWith('/oauth/token')) return json({ error: 'invalid_grant' }, 400);
    authorizations.push(init.headers.Authorization);
    return json({ errors: [{ message: 'Unauthorized' }] }, 401);
  };
  await assert.rejects(account.query(CUSTOMER_QUERY), { code: 'NOT_LOGGED_IN' });
  assert.deepEqual(authorizations, ['tok-1'], 'no second request without a token');
  assert.equal(sessionStorage.getItem(SESSION_KEY), null);
  assert.equal(account.isLoggedIn(), false);
});

test('browser mode: only invalid_grant ends the session; another token refusal is an error that keeps it', async () => {
  configure({ ...testConfig(), account: { clientId: 'client-1' } });
  storeSession({ expiresAt: Date.now() - 1000, refresh: 'refresh-1' });
  globalThis.fetch = async (url) => discovery(String(url)) ?? json({ error: 'invalid_client' }, 401);
  await assert.rejects(account.getToken(), { code: 'TOKEN_FAILED', status: 401 });
  assert.equal(JSON.parse(sessionStorage.getItem(SESSION_KEY)).refresh, 'refresh-1', 'the session is kept');
  assert.equal(account.isLoggedIn(), true);

  globalThis.fetch = async (url) => discovery(String(url)) ?? json({ error: 'invalid_grant' }, 400);
  assert.equal(await account.getToken(), null);
  assert.equal(sessionStorage.getItem(SESSION_KEY), null, 'Shopify ended the login');
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

test('browser mode: the id token is checked as the Worker checks it, azp and iat included', async () => {
  configure({ ...testConfig(), account: { clientId: 'client-1' } });
  const now = Date.now() / 1000;
  const good = {
    iss: 'https://shopify.com/authentication/1',
    aud: 'client-1',
    sub: 'gid://shopify/Customer/1',
    nonce: 'nonce-1',
    iat: now,
    exp: now + 3600,
  };
  for (const [claims, reason] of [
    [{ ...good, azp: 'another-client' }, 'authorized party'],
    [{ ...good, aud: ['client-1', 'another-client'] }, 'authorized party missing'],
    [{ ...good, iat: undefined }, 'issued-at missing'],
    [{ ...good, exp: String(now + 3600) }, 'expired'],
    [{ ...good, sub: undefined }, 'subject missing'],
  ]) {
    sessionStorage.setItem(
      'tether:account-login:shop.test',
      JSON.stringify({
        state: 's-1',
        nonce: 'nonce-1',
        verifier: 'v',
        redirect: 'https://site.test/account',
        returnTo: '',
        at: Date.now(),
      }),
    );
    window.history.replaceState(null, '', '/account?code=c-1&state=s-1');
    const idToken = `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
    globalThis.fetch = async (url) =>
      discovery(String(url)) ?? json({ access_token: 'tok-1', id_token: idToken, expires_in: 3600 });
    await assert.rejects(account.handleCallback(), {
      message: `Customer accounts: the login answer did not check out (${reason})`,
    });
    assert.equal(sessionStorage.getItem(SESSION_KEY), null, 'no session');
  }
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
