// The account operations' routes: own data only, the origin and CSRF rules, and input checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE } from '../src/account.ts';
import { MAX_ACCOUNT_BODY_BYTES } from '../src/account/http.ts';
import { SITE, WORKER, req, loginFlow } from './account-fixtures.js';
import { recordsAt } from './mocks.js';

test('me / orders: only for the allowed origin, with the cookie', async () => {
  const { run, cookie } = await loginFlow();
  const me = await run(req('/me', { origin: SITE, cookie }));
  assert.equal(me.headers.get('access-control-allow-origin'), SITE);
  assert.equal(me.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(me.headers.get('cache-control'), 'no-store');
  const data = await me.json();
  assert.equal(data.loggedIn, true);
  assert.equal(data.customer.email, 'ada@x.test');
  assert.ok(!JSON.stringify(data).includes('access-'), 'no token in answers');
  const { orders } = await (await run(req('/orders?first=5', { origin: SITE, cookie }))).json();
  assert.deepEqual(
    orders,
    [
      {
        id: 'o1',
        name: '#1001',
        processedAt: null,
        financialStatus: null,
        fulfillmentStatus: null,
        statusPageUrl: null,
        totalPrice: { amount: '10.0', currencyCode: 'EUR' },
        lineItems: { nodes: [] },
      },
    ],
    'the parsed order the browser reads, every field present',
  );
  const same = new Request(`${WORKER}${BASE}/me`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal((await (await run(same)).json()).loggedIn, true, 'same-origin GET without Origin');
  const cross = new Request(`${WORKER}${BASE}/me`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal((await run(cross)).status, 403);
  assert.equal((await run(req('/me', { origin: 'https://evil.example', cookie }))).status, 403);
  assert.equal((await run(req('/me', { cookie }))).status, 403);
  assert.equal((await (await run(req('/me', { origin: SITE }))).json()).loggedIn, false);
});

test('a POST without the X-Tether-Account header is refused (CSRF)', async () => {
  const { run, cookie } = await loginFlow();
  const res = await run(
    req('/cart', { method: 'POST', origin: SITE, cookie, body: { cartId: 'gid://shopify/Cart/abc' }, header: false }),
  );
  assert.equal(res.status, 400);
});

test('an account body past the limit is refused with 413 before it is read whole', async () => {
  const { run, cookie } = await loginFlow();
  const cartId = 'gid://shopify/Cart/abc';
  const padding = 'x'.repeat(MAX_ACCOUNT_BODY_BYTES);
  /**
   * @param {string} path
   * @param {unknown} body
   */
  const post = (path, body) => run(req(path, { method: 'POST', origin: SITE, cookie, body }));
  for (const path of ['/cart', '/logout', '/address']) {
    const res = await post(path, { cartId, padding });
    assert.equal(res.status, 413, path);
    assert.equal(res.headers.get('access-control-allow-origin'), SITE, `${path}: the site can read the answer`);
  }
  const declared = new Request(`${WORKER}${BASE}/logout`, {
    method: 'POST',
    headers: { Origin: SITE, Cookie: cookie, 'X-Tether-Account': '1', 'Content-Length': String(1024 * 1024) },
    body: '{}',
  });
  assert.equal((await run(declared)).status, 413, 'a declared length past the limit is refused unread');
  assert.equal((await post('/logout', { returnTo: `${SITE}/bye` })).status, 200, 'a small body still logs out');
});

test('account operations: fixed routes, own data only, CSRF and origin rules, validated input', async () => {
  const { run, cookie, sh } = await loginFlow();
  /** @param {string} path */
  const get = (path) => run(req(path, { origin: SITE, cookie }));
  /**
   * @param {string} path
   * @param {unknown} body
   * @param {{ header?: boolean }} [opts]
   */
  const post = (path, body, opts = {}) => run(req(path, { method: 'POST', origin: SITE, cookie, body, ...opts }));
  /** @param {Response} response */
  const body = async (response) => ({ status: response.status, ...(await response.json()) });

  // Order detail: own order, numeric id accepted; someone else's order is null; a wrong id type is refused.
  assert.equal((await body(await get('/order?id=1'))).order.name, '#1001');
  assert.equal((await body(await get('/order?id=gid://shopify/Order/2'))).order, null);
  assert.equal((await get('/order?id=gid://shopify/Customer/1')).status, 400);
  assert.equal((await get('/order?id=1%20OR%201')).status, 400);

  // Addresses: list (default marked), create with validation errors passed on, update, delete.
  const list = await body(await get('/addresses'));
  assert.deepEqual(
    recordsAt(list, 'addresses').map((address) => address['isDefault']),
    [true, false],
  );
  const created = await body(
    await post('/address', {
      address: { city: 'Leiden', countryCode: 'nl', evil: 'x', address1: 'Breestraat 1' },
      isDefault: true,
    }),
  );
  assert.equal(created.address.city, 'Leiden');
  const sent = sh.calls.findLast((call) => call.op === 'TetherAddressCreate')?.variables;
  assert.deepEqual(sent?.['address'], { address1: 'Breestraat 1', city: 'Leiden', countryCode: 'NL' });
  assert.equal(sent?.['default'], true);
  const invalid = await body(await post('/address', { address: { address1: 'No city' } }));
  assert.equal(invalid.status, 400);
  assert.match(invalid.error, /City is required/);
  assert.equal((await post('/address', { address: { city: 'x'.repeat(300) } })).status, 400);
  assert.equal(
    (await post('/address', { address: { city: 'X' }, id: 'gid://shopify/Order/1' })).status,
    400,
    'wrong id type',
  );
  assert.equal(
    (await body(await post('/address/delete', { id: 'gid://shopify/CustomerAddress/2' }))).deleted,
    'gid://shopify/CustomerAddress/2',
  );

  // Profile: only first and last name reach Shopify.
  await post('/profile', { firstName: 'Ada', lastName: 'Lovelace', email: 'x@evil.test' });
  assert.deepEqual(sh.calls.findLast((call) => call.op === 'TetherProfile')?.variables?.['input'], {
    firstName: 'Ada',
    lastName: 'Lovelace',
  });

  // Subscriptions: list; actions only on the customer's own contract, looked up through the customer first.
  assert.equal((await body(await get('/subscriptions'))).subscriptions[0].status, 'ACTIVE');
  assert.equal((await body(await post('/subscription', { id: 1, action: 'pause' }))).contract.status, 'PAUSED');
  assert.equal((await body(await post('/subscription', { id: 1, action: 'resume' }))).contract.status, 'ACTIVE');
  assert.equal(
    (await body(await post('/subscription', { id: 1, action: 'skip' }))).billingCycle.cycleIndex,
    3,
    'skips the next unskipped cycle',
  );
  assert.equal((await body(await post('/subscription', { id: 1, action: 'cancel' }))).contract.status, 'CANCELLED');
  const before = sh.calls.length;
  const foreign = await post('/subscription', { id: 'gid://shopify/SubscriptionContract/2', action: 'cancel' });
  assert.equal(foreign.status, 404, "not the customer's contract");
  assert.ok(!sh.calls.slice(before).some((call) => call.op === 'TetherCancel'), 'no mutation for a foreign contract');
  assert.equal((await post('/subscription', { id: 1, action: 'delete' })).status, 400);

  // Returns: validated lines.
  assert.equal(
    (await body(await post('/return', { orderId: 1, lines: [{ lineItemId: 1, quantity: 1, note: 'Too big' }] }))).return
      .status,
    'REQUESTED',
  );
  assert.equal((await post('/return', { orderId: 1, lines: [{ lineItemId: 1, quantity: 0 }] })).status, 400);
  assert.equal((await post('/return', { orderId: 1, lines: [] })).status, 400);

  // Every call used the session's own token.
  assert.ok(sh.calls.filter((call) => call.op).every((call) => /^access-/.test(call.auth ?? '')));

  // CSRF and origin: no header -> refused; other origin -> refused; no cookie -> 401; GET-only routes refuse POST.
  const callsBefore = sh.calls.length;
  assert.equal((await post('/subscription', { id: 1, action: 'cancel' }, { header: false })).status, 400);
  assert.equal(
    (
      await run(
        req('/subscription', {
          method: 'POST',
          origin: 'https://evil.example',
          cookie,
          body: { id: 1, action: 'cancel' },
        }),
      )
    ).status,
    403,
  );
  assert.equal((await run(req('/address/delete', { method: 'POST', origin: SITE, body: { id: 1 } }))).status, 401);
  assert.equal((await run(req('/subscriptions', { origin: SITE }))).status, 401);
  assert.equal((await run(req('/subscriptions', { method: 'POST', origin: SITE, cookie, body: {} }))).status, 404);
  assert.equal(sh.calls.length, callsBefore, 'nothing reached Shopify');
});

test('address update: fields sent empty are cleared; a new address leaves them out', async () => {
  const { addressInput } = await import('../src/account/operations.ts');
  const form = { address1: 'Main 1', address2: '', phoneNumber: '', city: 'Utrecht' };
  assert.deepEqual(addressInput(form, { clear: true }), {
    address1: 'Main 1',
    address2: '',
    city: 'Utrecht',
    phoneNumber: '',
  });
  assert.deepEqual(addressInput(form), { address1: 'Main 1', city: 'Utrecht' });
  assert.deepEqual(
    addressInput({ city: 'Utrecht' }, { clear: true }),
    { city: 'Utrecht' },
    'fields not sent stay as they are',
  );
});

test('userErrors from Shopify are parsed: an entry without a message still refuses the change', async () => {
  const { ops, InputError } = await import('../src/account/operations.ts');
  const ask = async () => ({ customerUpdate: { customer: null, userErrors: [{ field: ['firstName', 3] }, 'odd'] } });
  await assert.rejects(ops.profile(ask, { firstName: 'Ada' }), (error) => {
    assert.ok(error instanceof InputError);
    assert.deepEqual(error.userErrors, [
      { field: null, message: 'Shopify refused the change' },
      { field: null, message: 'Shopify refused the change' },
    ]);
    return true;
  });
});

test('the browser and the Worker agree on every operation route', async () => {
  const { ops } = await import('../src/account/operations.ts');
  const { OPERATION_ROUTES, operationCall, operationRequest } = await import('../src/shared/account-routes.ts');
  assert.deepEqual(Object.keys(OPERATION_ROUTES).sort(), Object.keys(ops).sort());
  /**
   * @param {string} name A key `Object.keys` names as a string.
   * @returns {name is keyof typeof ops}
   */
  const isOperation = (name) => Object.hasOwn(ops, name);
  for (const name of Object.keys(ops).filter(isOperation)) {
    const { method, path } = operationRequest(name, { id: 'gid://shopify/Order/1' });
    const url = new URL(`${WORKER}${BASE}${path}`);
    const call = operationCall(method, url.pathname.slice(BASE.length), url, { id: 'gid://shopify/Order/1' });
    assert.equal(call?.name, name);
  }
  assert.equal(
    operationRequest('order', { id: 'gid://shopify/Order/1' }).path,
    '/order?id=gid%3A%2F%2Fshopify%2FOrder%2F1',
  );
});
