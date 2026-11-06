// Customer accounts through the Worker: the safe mode. A simulated Shopify that signs id tokens
// with a real RSA key, and the attacks the Worker has to refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAccount, BASE } from '../src/account.ts';

const SHOP = 'shop.myshopify.com';
const SITE = 'https://shop.example';
const WORKER = 'https://shop.example'; // a route on the shop's own domain
const env = {
  ACCOUNT_CLIENT_ID: 'client-1',
  ACCOUNT_ORIGINS: SITE,
  SHOPIFY_DOMAIN: SHOP,
  STOREFRONT_TOKEN: 'public-token',
  ACCOUNT_SECRET: 'a-long-account-secret-of-24-plus-chars',
};
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
async function idToken(claims, { tamper = false, kid = 'k1' } = {}) {
  const h = b64url(JSON.stringify(kid ? { alg: 'RS256', kid } : { alg: 'RS256' }));
  const p = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`)),
  );
  if (tamper) sig[5] ^= 1;
  return `${h}.${p}.${b64url(sig)}`;
}

function shopify({ tamper = false, wrongNonce = false, kid = 'k1', claims = {} } = {}) {
  const calls = [];
  let lastNonce = null;
  const fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const ok = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/.well-known/openid-configuration')) {
      return ok({
        issuer: 'https://shopify.com/authentication/1',
        authorization_endpoint: 'https://shopify.com/authentication/1/oauth/authorize',
        token_endpoint: 'https://shopify.com/authentication/1/oauth/token',
        end_session_endpoint: 'https://shopify.com/authentication/1/logout',
        jwks_uri: 'https://shopify.com/authentication/1/.well-known/jwks.json',
      });
    }
    if (u.endsWith('/.well-known/customer-account-api'))
      return ok({ graphql_api: 'https://shopify.com/1/account/customer/api/2026-10/graphql' });
    if (u.endsWith('/jwks.json')) return ok({ keys: [jwk] });
    if (u.endsWith('/oauth/token')) {
      const body = new URLSearchParams(init.body);
      assert.equal(init.headers.Origin, SITE, 'the site origin, as Shopify expects');
      if (body.get('grant_type') === 'refresh_token') return ok({ access_token: 'access-2', expires_in: 3600 });
      const token = await idToken(
        {
          iss: 'https://shopify.com/authentication/1',
          aud: 'client-1',
          nonce: wrongNonce ? 'other' : lastNonce,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          sub: 'gid://shopify/Customer/1',
          ...claims,
        },
        { tamper, kid },
      );
      return ok({ access_token: 'access-1', refresh_token: 'refresh-1', id_token: token, expires_in: 3600 });
    }
    if (u.includes('/account/customer/api/')) {
      const { query: q, variables: v = {} } = JSON.parse(init.body);
      const op = (q.match(/(?:query|mutation)\s+(\w+)/) || [])[1];
      calls.push({ op, variables: v, auth: init.headers.Authorization });
      const mine = (id) =>
        ['gid://shopify/Order/1', 'gid://shopify/SubscriptionContract/1', 'gid://shopify/CustomerAddress/1'].includes(
          id,
        );
      if (op === 'TetherOrder')
        return ok({
          data: {
            order: mine(v.id)
              ? {
                  id: v.id,
                  name: '#1001',
                  lineItems: { nodes: [{ id: 'gid://shopify/LineItem/1', title: 'Tee', quantity: 1 }] },
                  returnInformation: {
                    returnableLineItems: { nodes: [{ quantity: 1, lineItem: { id: 'gid://shopify/LineItem/1' } }] },
                  },
                }
              : null,
          },
        });
      if (op === 'TetherAddresses')
        return ok({
          data: {
            customer: {
              defaultAddress: { id: 'gid://shopify/CustomerAddress/1' },
              addresses: {
                nodes: [
                  { id: 'gid://shopify/CustomerAddress/1', city: 'Utrecht' },
                  { id: 'gid://shopify/CustomerAddress/2', city: 'Delft' },
                ],
              },
            },
          },
        });
      if (op === 'TetherSubscriptions')
        return ok({
          data: {
            customer: {
              subscriptionContracts: { nodes: [{ id: 'gid://shopify/SubscriptionContract/1', status: 'ACTIVE' }] },
            },
          },
        });
      if (op === 'TetherContract')
        return ok({
          data: {
            customer: {
              subscriptionContract: mine(v.id)
                ? { id: v.id, status: 'ACTIVE', upcomingBillingCycles: { nodes: [{ cycleIndex: 3, skipped: false }] } }
                : null,
            },
          },
        });
      if (op === 'TetherProfile') return ok({ data: { customerUpdate: { customer: v.input, userErrors: [] } } });
      if (op === 'TetherAddressCreate')
        return ok({
          data: {
            customerAddressCreate: {
              customerAddress: { id: 'gid://shopify/CustomerAddress/9', ...v.address },
              userErrors: v.address.city ? [] : [{ field: ['city'], message: 'City is required' }],
            },
          },
        });
      if (op === 'TetherAddressUpdate')
        return ok({ data: { customerAddressUpdate: { customerAddress: { id: v.id, ...v.address }, userErrors: [] } } });
      if (op === 'TetherAddressDelete')
        return ok({ data: { customerAddressDelete: { deletedAddressId: v.id, userErrors: [] } } });
      if (op === 'TetherPause')
        return ok({
          data: { subscriptionContractPause: { contract: { id: v.id, status: 'PAUSED' }, userErrors: [] } },
        });
      if (op === 'TetherResume')
        return ok({
          data: { subscriptionContractActivate: { contract: { id: v.id, status: 'ACTIVE' }, userErrors: [] } },
        });
      if (op === 'TetherCancel')
        return ok({
          data: { subscriptionContractCancel: { contract: { id: v.id, status: 'CANCELLED' }, userErrors: [] } },
        });
      if (op === 'TetherSkip')
        return ok({
          data: {
            subscriptionBillingCycleSkip: {
              billingCycle: { cycleIndex: v.input.selector.index, skipped: true },
              userErrors: [],
            },
          },
        });
      if (op === 'TetherReturn')
        return ok({
          data: {
            orderRequestReturn: { return: { id: 'gid://shopify/Return/1', status: 'REQUESTED' }, userErrors: [] },
          },
        });
      if (/TetherOrders/.test(q))
        return ok({
          data: {
            customer: {
              orders: { nodes: [{ id: 'o1', name: '#1001', totalPrice: { amount: '10.0', currencyCode: 'EUR' } }] },
            },
          },
        });
      return ok({
        data: {
          customer: {
            id: 'c1',
            firstName: 'Ada',
            lastName: 'L',
            displayName: 'Ada L',
            emailAddress: { emailAddress: 'ada@x.test' },
            defaultAddress: null,
          },
        },
      });
    }
    if (u.includes(`${SHOP}/api/`))
      return ok({
        data: {
          cartBuyerIdentityUpdate: { cart: { checkoutUrl: 'https://shop.example/checkouts/c/1' }, userErrors: [] },
        },
      });
    throw new Error(`unexpected ${u}`);
  };
  return {
    fetch,
    calls,
    setNonce: (n) => {
      lastNonce = n;
    },
  };
}

const req = (path, { method = 'GET', origin, cookie, body, header = true } = {}) =>
  new Request(`${WORKER}${BASE}${path}`, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method === 'POST' && header ? { 'X-Tether-Account': '1', 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const cookiesOf = (res) => res.headers.getSetCookie?.() || [res.headers.get('set-cookie')].filter(Boolean);
const pick = (res, name) => (cookiesOf(res).find((c) => c.startsWith(`${name}=`)) || '').split(';')[0];

async function loginFlow({ memory = new Map(), wrapFetch = (inner) => inner, sessionCookie, ...opts } = {}) {
  const sh = shopify(opts);
  const fetch = wrapFetch(sh.fetch);
  const run = (r) => handleAccount(r, env, { fetch, memory });
  const start = await run(req(`/login?returnTo=${encodeURIComponent(`${SITE}/account`)}`));
  const authorize = new URL(start.headers.get('location'));
  sh.setNonce(authorize.searchParams.get('nonce'));
  const loginCookie = pick(start, '__Host-tether-login');
  const callbackPath = `/callback?code=the-code&state=${authorize.searchParams.get('state')}`;
  const back = await run(req(callbackPath, { cookie: [loginCookie, sessionCookie].filter(Boolean).join('; ') }));
  return {
    sh,
    memory,
    run,
    start,
    authorize,
    back,
    loginCookie,
    callbackPath,
    cookie: pick(back, '__Host-tether-account'),
  };
}

const sessionKeys = (memory) => [...memory.keys()].filter((key) => key.startsWith('s:'));

test('login: PKCE redirect, pending login sealed in a cookie (nothing in KV), then a session cookie only', async () => {
  const { start, authorize, back, cookie, loginCookie, memory } = await loginFlow();
  assert.equal(start.status, 302);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${WORKER}${BASE}/callback`);
  assert.match(
    cookiesOf(start)[0],
    /^__Host-tether-login=[\w.-]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/,
  );
  assert.ok(!loginCookie.includes(authorize.searchParams.get('state')), 'sealed, not readable');
  assert.equal(back.status, 302);
  assert.match(back.headers.get('location'), /^https:\/\/shop\.example\/account\?account=in$/);
  const set = cookiesOf(back).join('\n');
  assert.match(set, /__Host-tether-account=[\w-]{40,}; Path=\/; Secure; HttpOnly; SameSite=Lax/);
  assert.match(set, /__Host-tether-login=; .*Max-Age=0/, 'login cookie cleared');
  assert.ok(!/access-1|refresh-1/.test(set), 'no token in cookies');
  const stored = [...memory.values()].map((entry) => entry.value).join(' ');
  assert.equal(memory.size, 1, 'only the session in KV');
  assert.ok(!/access-1|refresh-1|eyJ/.test(stored), 'tokens are encrypted at rest');
  assert.ok(![...memory.keys()].some((k) => k.includes(cookie.split('=')[1])), 'the session id itself is not a key');
});

test('login CSRF: a callback without the login cookie of this browser is refused (attacker code + state)', async () => {
  const sh = shopify();
  const memory = new Map();
  const run = (r) => handleAccount(r, env, { fetch: sh.fetch, memory });
  const attacker = await run(req('/login'));
  const a = new URL(attacker.headers.get('location'));
  sh.setNonce(a.searchParams.get('nonce'));
  // The attacker keeps their own code+state and sends the victim to the callback, without their cookie.
  const victim = await run(req(`/callback?code=attacker-code&state=${a.searchParams.get('state')}`));
  assert.ok(!pick(victim, '__Host-tether-account'), 'no session for the victim');
  assert.match(victim.headers.get('location'), /account=expired/);
  // Or with a login cookie of another login (the victim's own): states differ, refused.
  const own = await run(req('/login'));
  const wrong = await run(
    req(`/callback?code=attacker-code&state=${a.searchParams.get('state')}`, {
      cookie: pick(own, '__Host-tether-login'),
    }),
  );
  assert.ok(!pick(wrong, '__Host-tether-account'));
  assert.equal(memory.size, 0, 'and anonymous /login never writes to KV');
});

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

test('a tampered or wrong id token gets no session, and the visitor lands on the site with account=error', async () => {
  const inAnHour = Math.floor(Date.now() / 1000) + 3600;
  const attacks = [
    { tamper: true },
    { wrongNonce: true },
    { kid: null },
    { kid: 'unknown-key' },
    { claims: { iat: inAnHour } },
    { claims: { nbf: inAnHour } },
  ];
  for (const opts of attacks) {
    const { back, memory } = await loginFlow(opts);
    assert.ok(!pick(back, '__Host-tether-account'), JSON.stringify(opts));
    assert.equal(back.status, 302, JSON.stringify(opts));
    assert.equal(back.headers.get('location'), `${SITE}/?account=error`);
    assert.match(cookiesOf(back).join('\n'), /__Host-tether-login=; .*Max-Age=0/, 'login cookie cleared');
    assert.equal(memory.size, 0);
  }
});

test('a token answer whose id_token is not a string fails the login instead of crashing', async () => {
  const wrapFetch = (inner) => async (url, init) => {
    if (!String(url).endsWith('/oauth/token')) return inner(url, init);
    return new Response(JSON.stringify({ access_token: 'access-1', id_token: 42, expires_in: 3600 }), { status: 200 });
  };
  const { back } = await loginFlow({ wrapFetch });
  assert.equal(back.headers.get('location'), `${SITE}/?account=error`);
  assert.ok(!pick(back, '__Host-tether-account'));
});

test('a login callback older than ten minutes is refused as expired, back where the login started', async () => {
  const flow = await loginFlow();
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60e3;
  try {
    const late = await flow.run(req(flow.callbackPath, { cookie: flow.loginCookie }));
    assert.ok(!pick(late, '__Host-tether-account'));
    assert.equal(late.headers.get('location'), `${SITE}/account?account=expired`);
  } finally {
    Date.now = realNow;
  }
});

test('a replayed callback with the same login cookie gets no session: Shopify refuses the spent code', async () => {
  const spent = new Set();
  const wrapFetch = (inner) => async (url, init) => {
    if (String(url).endsWith('/oauth/token')) {
      const code = new URLSearchParams(init.body).get('code');
      if (spent.has(code)) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      spent.add(code);
    }
    return inner(url, init);
  };
  const flow = await loginFlow({ wrapFetch });
  assert.ok(flow.cookie, 'the first callback logs in');
  const replay = await flow.run(req(flow.callbackPath, { cookie: flow.loginCookie }));
  assert.ok(!pick(replay, '__Host-tether-account'));
  assert.equal(replay.headers.get('location'), `${SITE}/?account=error`);
  assert.equal(sessionKeys(flow.memory).length, 1, 'only the first session exists');
});

test('a POST without the X-Tether-Account header is refused (CSRF)', async () => {
  const { run, cookie } = await loginFlow();
  const res = await run(
    req('/cart', { method: 'POST', origin: SITE, cookie, body: { cartId: 'gid://shopify/Cart/abc' }, header: false }),
  );
  assert.equal(res.status, 400);
});

test('a returnTo on another site lands on the shop instead (no open redirect)', async () => {
  const sh = shopify();
  const memory = new Map();
  const run = (r) => handleAccount(r, env, { fetch: sh.fetch, memory });
  const evil = await run(req(`/login?returnTo=${encodeURIComponent('https://evil.example/steal')}`));
  const authorize = new URL(evil.headers.get('location'));
  sh.setNonce(authorize.searchParams.get('nonce'));
  const landed = await run(
    req(`/callback?code=c&state=${authorize.searchParams.get('state')}`, { cookie: pick(evil, '__Host-tether-login') }),
  );
  assert.match(landed.headers.get('location'), /^https:\/\/shop\.example\//);
});

test("one session's sealed blob copied under another session's key does not open", async () => {
  const memory = new Map();
  const first = await loginFlow({ memory });
  const second = await loginFlow({ memory });
  const [firstKey, secondKey] = sessionKeys(memory);
  assert.ok(firstKey && secondKey && firstKey !== secondKey);
  memory.set(secondKey, memory.get(firstKey));
  const me = (cookie) => first.run(req('/me', { origin: SITE, cookie }));
  assert.equal((await (await me(second.cookie)).json()).loggedIn, false, 'the copy is bound to the first key');
  assert.equal((await (await me(first.cookie)).json()).loggedIn, true, 'the original still opens');
});

test('a new login ends the session the browser already had', async () => {
  const memory = new Map();
  const first = await loginFlow({ memory });
  const second = await loginFlow({ memory, sessionCookie: first.cookie });
  assert.ok(second.cookie && second.cookie !== first.cookie);
  assert.equal(sessionKeys(memory).length, 1);
  const me = (cookie) => second.run(req('/me', { origin: SITE, cookie }));
  assert.equal((await (await me(first.cookie)).json()).loggedIn, false);
  assert.equal((await (await me(second.cookie)).json()).loggedIn, true);
});

test('cart link, refresh, absolute lifetime, a 401 from Shopify ends the session', async () => {
  const { run, cookie, sh, memory } = await loginFlow();
  const linked = await (
    await run(req('/cart', { method: 'POST', origin: SITE, cookie, body: { cartId: 'gid://shopify/Cart/abc?key=k1' } }))
  ).json();
  assert.equal(linked.linked, true);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 2 * 3600e3;
    assert.equal((await (await run(req('/me', { origin: SITE, cookie }))).json()).loggedIn, true);
    assert.ok(
      sh.calls.some(
        (c) => c.url.endsWith('/oauth/token') && new URLSearchParams(c.init.body).get('grant_type') === 'refresh_token',
      ),
    );
    Date.now = () => realNow() + 15 * 86400e3; // past the 14-day lifetime, even though it was in use
    assert.equal((await (await run(req('/me', { origin: SITE, cookie }))).json()).loggedIn, false);
    assert.equal(memory.size, 0);
  } finally {
    Date.now = realNow;
  }
});

test('logout never fails open: session ended and cookie cleared even when Shopify is down; id token never in the answer', async () => {
  const { run, cookie, memory, sh } = await loginFlow();
  const down = async (url, init) =>
    /well-known|oauth\/token/.test(String(url)) ? new Response('down', { status: 503 }) : sh.fetch(url, init);
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600e3; // access expired, and refresh would fail
  let res;
  try {
    res = await handleAccount(
      req('/logout', {
        method: 'POST',
        origin: SITE,
        cookie,
        body: { returnTo: `${SITE}/bye`, cartId: 'gid://shopify/Cart/abc?key=k1' },
      }),
      env,
      { fetch: down, memory },
    );
  } finally {
    Date.now = realNow;
  }
  assert.equal(res.status, 200);
  assert.match(pick(res, '__Host-tether-account') + cookiesOf(res).join(), /Max-Age=0/);
  assert.equal(memory.size, 0, 'session deleted');
  const body = await res.json();
  assert.equal(body.loggedOut, true);
  assert.ok(!JSON.stringify(body).includes('eyJ'), 'no id token for scripts');
  assert.equal(body.logoutUrl, `${WORKER}${BASE}/logout/go`);
  // step 2: the one-time cookie carries the id token to Shopify's logout
  const go = await run(req('/logout/go', { cookie: pick(res, '__Host-tether-logout') }));
  assert.match(
    go.headers.get('location'),
    /\/logout\?id_token_hint=.+&post_logout_redirect_uri=https%3A%2F%2Fshop\.example%2Fbye/,
  );
  assert.match(cookiesOf(go).join(), /__Host-tether-logout=; .*Max-Age=0/);
  assert.equal((await (await run(req('/me', { origin: SITE, cookie }))).json()).loggedIn, false);
  void run;
});

test('settings: not set up -> 404; missing pieces -> 503 without details for the public', async () => {
  assert.equal((await handleAccount(req('/me'), {}, {})).status, 404);
  const r = await handleAccount(req('/me'), { ACCOUNT_CLIENT_ID: 'x', SHOPIFY_DOMAIN: SHOP }, {});
  assert.equal(r.status, 503);
  assert.doesNotMatch(JSON.stringify(await r.json()), /ACCOUNT_ORIGINS|SYNC_SECRET/);
  assert.equal(await handleAccount(new Request('https://x/other'), env, {}), null, 'other routes pass through');
});

test('refresh race: two requests refresh at once (Shopify rotates the refresh token): both stay logged in', async () => {
  const { memory, cookie, sh } = await loginFlow();
  let rotated = false;
  let refreshes = 0;
  const rotating = async (url, init) => {
    if (String(url).endsWith('/oauth/token') && new URLSearchParams(init.body).get('grant_type') === 'refresh_token') {
      refreshes++;
      await new Promise((r) => setTimeout(r, rotated ? 0 : 5));
      if (rotated) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }); // the old refresh token is spent
      rotated = true;
      return new Response(JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }), {
        status: 200,
      });
    }
    return sh.fetch(url, init);
  };
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600e3;
  try {
    const run = (path) => handleAccount(req(path, { origin: SITE, cookie }), env, { fetch: rotating, memory });
    const [a, b] = await Promise.all([run('/me'), run('/orders')]);
    assert.equal((await a.json()).loggedIn, true);
    assert.equal((await b.json()).loggedIn, true, 'the loser uses the session the winner refreshed');
    assert.equal(refreshes, 1, 'requests in one isolate share one refresh');
  } finally {
    Date.now = realNow;
  }
});

test('a 401 from Shopify (session ended there) ends it here too', async () => {
  const { memory, cookie, sh } = await loginFlow();
  const ended = async (url, init) =>
    String(url).includes('/account/customer/api/') ? new Response('{}', { status: 401 }) : sh.fetch(url, init);
  const r = await handleAccount(req('/me', { origin: SITE, cookie }), env, { fetch: ended, memory });
  assert.equal((await r.json()).loggedIn, false);
  assert.equal(memory.size, 0);
  assert.match(cookiesOf(r).join(), /__Host-tether-account=; .*Max-Age=0/, 'the dead session cookie is cleared');
  const orders = await handleAccount(req('/orders', { origin: SITE, cookie }), env, { fetch: ended, memory });
  assert.equal(orders.status, 401, 'data routes answer 401 without a session; /me answers 200');
  assert.deepEqual(await orders.json(), { loggedIn: false, orders: [] });
});

test('the store domain refuses Workers (403 on .well-known): addresses come from the shop id instead', async () => {
  const sh = shopify();
  const blocked = { ...env, SHOPIFY_DOMAIN: 'blocked.myshopify.com' };
  const asked = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    asked.push(u);
    if (u.startsWith('https://blocked.myshopify.com/.well-known/')) return new Response('forbidden', { status: 403 });
    if (u.startsWith('https://blocked.myshopify.com/api/')) {
      assert.match(JSON.parse(init.body).query, /shop \{ id \}/);
      return new Response(JSON.stringify({ data: { shop: { id: 'gid://shopify/Shop/1' } } }), { status: 200 });
    }
    return sh.fetch(url, init);
  };
  const memory = new Map();
  const run = (r) => handleAccount(r, blocked, { fetch, memory });
  const start = await run(req('/login'));
  assert.equal(start.status, 302);
  const a = new URL(start.headers.get('location'));
  assert.equal(a.origin + a.pathname, 'https://shopify.com/authentication/1/oauth/authorize');
  assert.ok(asked.includes('https://shopify.com/authentication/1/.well-known/openid-configuration'));
  sh.setNonce(a.searchParams.get('nonce'));
  const back = await run(
    req(`/callback?code=c&state=${a.searchParams.get('state')}`, { cookie: pick(start, '__Host-tether-login') }),
  );
  const cookie = pick(back, '__Host-tether-account');
  assert.ok(cookie, 'logged in');
  const me = await run(req('/me', { origin: SITE, cookie }));
  assert.equal((await me.json()).customer.firstName, 'Ada');
  assert.ok(
    asked.some((u) => u.startsWith('https://shopify.com/1/account/customer/api/')),
    'the Customer Account API by shop id',
  );
});

test('account operations: fixed routes, own data only, CSRF and origin rules, validated input', async () => {
  const { run, cookie, sh } = await loginFlow();
  const get = (path) => run(req(path, { origin: SITE, cookie }));
  const post = (path, body, opts = {}) => run(req(path, { method: 'POST', origin: SITE, cookie, body, ...opts }));
  const body = async (r) => ({ status: r.status, ...(await r.json()) });

  // Order detail: own order, numeric id accepted; someone else's order is null; a wrong id type is refused.
  assert.equal((await body(await get('/order?id=1'))).order.name, '#1001');
  assert.equal((await body(await get('/order?id=gid://shopify/Order/2'))).order, null);
  assert.equal((await get('/order?id=gid://shopify/Customer/1')).status, 400);
  assert.equal((await get('/order?id=1%20OR%201')).status, 400);

  // Addresses: list (default marked), create with validation errors passed on, update, delete.
  const list = await body(await get('/addresses'));
  assert.deepEqual(
    list.addresses.map((a) => a.isDefault),
    [true, false],
  );
  const created = await body(
    await post('/address', {
      address: { city: 'Leiden', countryCode: 'nl', evil: 'x', address1: 'Breestraat 1' },
      isDefault: true,
    }),
  );
  assert.equal(created.address.city, 'Leiden');
  const sent = sh.calls.findLast((c) => c.op === 'TetherAddressCreate').variables;
  assert.deepEqual(Object.keys(sent.address).sort(), ['address1', 'city', 'countryCode']);
  assert.equal(sent.address.countryCode, 'NL');
  assert.equal(sent.default, true);
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
  assert.deepEqual(sh.calls.findLast((c) => c.op === 'TetherProfile').variables.input, {
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
  assert.ok(!sh.calls.slice(before).some((c) => c.op === 'TetherCancel'), 'no mutation for a foreign contract');
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
  assert.ok(sh.calls.filter((c) => c.op).every((c) => /^access-/.test(c.auth)));

  // CSRF and origin: no header -> refused; other origin -> refused; no cookie -> 401; GET-only routes refuse POST.
  const n = sh.calls.length;
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
  assert.equal(sh.calls.length, n, 'nothing reached Shopify');
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

test('settings: ACCOUNT_SECRET is required, with no fallback to SYNC_SECRET; /check says what to set', async () => {
  const { accountSettings, accountProblems } = await import('../src/account.ts');
  const { ACCOUNT_SECRET, ...withoutSecret } = env;
  const syncOnly = { ...withoutSecret, SYNC_SECRET: 'a-long-sync-secret-of-24-plus-chars' };
  assert.equal(accountSettings(syncOnly).secret, null, 'SYNC_SECRET is never a session key');
  const [problem] = accountProblems(accountSettings(syncOnly));
  assert.equal(problem.severity, 'error');
  assert.match(problem.message, /ACCOUNT_SECRET is not set/);
  assert.match(problem.fix, /ACCOUNT_SECRET, a random string of at least 24 characters/);
  assert.match(problem.fix, /logs every customer out once/);

  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const r = await handleAccount(req('/me'), syncOnly, { memory: new Map() });
    assert.equal(r.status, 503);
    assert.doesNotMatch(JSON.stringify(await r.json()), /SECRET/, 'what is missing is not told to the public');
  } finally {
    console.error = realError;
  }
  assert.ok(logged.some((line) => /account setup ACCOUNT_SECRET is not set/.test(line)));

  for (const unusable of ['your-random-secret-of-24-characters', 'a']) {
    const settings = accountSettings({ ...env, ACCOUNT_SECRET: unusable });
    assert.equal(settings.secret, null, `${unusable}: an example or a short value is no key`);
  }
  assert.equal(accountSettings(env).secret, ACCOUNT_SECRET);
  assert.deepEqual(accountProblems(accountSettings(env)), []);
});

test('settings: unusable ACCOUNT_SESSION_DAYS and SHOPIFY_DOMAIN are reported, not silently replaced', async () => {
  const { accountSettings, accountProblems } = await import('../src/account.ts');
  const problems = (overrides) => accountProblems(accountSettings({ ...env, ...overrides }));
  for (const [raw, days] of [
    ['0', 1],
    ['abc', 14],
    ['200', 90],
    ['7.5', 14],
  ]) {
    const settings = accountSettings({ ...env, ACCOUNT_SESSION_DAYS: raw });
    assert.equal(settings.sessionDays.days, days, raw);
    assert.ok(problems({ ACCOUNT_SESSION_DAYS: raw }).some((p) => p.severity === 'warning' && p.message.includes(raw)));
  }
  assert.deepEqual(accountSettings({ ...env, ACCOUNT_SESSION_DAYS: '30' }).sessionDays, { kind: 'as-set', days: 30 });
  for (const domain of ['shop.myshopify.com/admin', 'shop .myshopify.com', 'shop.myshopify.com?x=1']) {
    assert.ok(
      problems({ SHOPIFY_DOMAIN: domain }).some((p) => p.severity === 'error' && /SHOPIFY_DOMAIN/.test(p.message)),
      domain,
    );
  }
  assert.ok(!problems({ SHOPIFY_DOMAIN: 'https://shop.myshopify.com/' }).some((p) => /SHOPIFY_DOMAIN/.test(p.message)));
});

test('without the TETHER_SYNC namespace the Worker refuses accounts instead of keeping sessions in memory', async () => {
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const r = await handleAccount(req('/login'), env, { fetch: shopify().fetch });
    assert.equal(r.status, 503);
    const notNamespace = await handleAccount(req('/login'), { ...env, TETHER_SYNC: 'a-string' }, {});
    assert.equal(notNamespace.status, 503, 'a setting by that name that is no namespace is not one');
  } finally {
    console.error = realError;
  }
  assert.ok(logged.some((line) => /TETHER_SYNC KV namespace is not bound/.test(line)));
});

test('a cancelled login lands where it started with account=error; a state mismatch is an error too', async () => {
  const sh = shopify();
  const memory = new Map();
  const run = (r) => handleAccount(r, env, { fetch: sh.fetch, memory });
  const realError = console.error;
  console.error = () => {};
  try {
    const start = await run(req(`/login?returnTo=${encodeURIComponent(`${SITE}/account`)}`));
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const loginCookie = pick(start, '__Host-tether-login');
    const cancelled = await run(req(`/callback?error=access_denied&state=${state}`, { cookie: loginCookie }));
    assert.equal(cancelled.headers.get('location'), `${SITE}/account?account=error`);
    assert.match(cookiesOf(cancelled).join(), /__Host-tether-login=; .*Max-Age=0/);
    const otherTab = await run(req('/callback?code=c&state=another-tabs-state', { cookie: loginCookie }));
    assert.equal(otherTab.headers.get('location'), `${SITE}/?account=error`);
  } finally {
    console.error = realError;
  }
  assert.equal(memory.size, 0);
});

test('id token claims: iat and sub must be there, times must be numbers, azp must name us with several audiences', async () => {
  const cases = [
    [{ iat: undefined }, 'no iat'],
    [{ sub: undefined }, 'no sub'],
    [{ exp: String(Math.floor(Date.now() / 1000) + 3600) }, 'a string exp'],
    [{ aud: ['client-1', 'someone-else'] }, 'several audiences without azp'],
    [{ aud: ['client-1', 'someone-else'], azp: 'someone-else' }, 'azp of another client'],
  ];
  const realError = console.error;
  console.error = () => {};
  try {
    for (const [claims, label] of cases) {
      const { back } = await loginFlow({ claims });
      assert.equal(back.headers.get('location'), `${SITE}/?account=error`, label);
    }
    const { back } = await loginFlow({ claims: { aud: ['client-1', 'someone-else'], azp: 'client-1' } });
    assert.match(back.headers.get('location'), /account=in/, 'several audiences with our azp');
  } finally {
    console.error = realError;
  }
});

test('discovery: when Shopify answers neither on the store domain nor on its account host, login fails closed', async () => {
  const sh = shopify();
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/.well-known/')) return new Response('forbidden', { status: 403 });
    if (u.startsWith('https://closed.myshopify.com/api/')) {
      return new Response(JSON.stringify({ data: { shop: { id: 'gid://shopify/Shop/9' } } }), { status: 200 });
    }
    return sh.fetch(url, init);
  };
  const r = await handleAccount(
    req('/login'),
    { ...env, SHOPIFY_DOMAIN: 'closed.myshopify.com' },
    {
      fetch,
      memory: new Map(),
    },
  );
  assert.equal(r.headers.get('location'), `${SITE}/?account=error`, 'no login is started against guessed endpoints');
  assert.equal(pick(r, '__Host-tether-login'), '__Host-tether-login=', 'and no pending login');
});

test('a session without a refresh token lasts as long as its access token, without asking Shopify again', async () => {
  const withoutRefresh = (inner) => async (url, init) => {
    const res = await inner(url, init);
    if (!String(url).endsWith('/oauth/token')) return res;
    const answer = await res.json();
    delete answer.refresh_token;
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  const { run, cookie, sh, memory } = await loginFlow({ wrapFetch: withoutRefresh });
  assert.equal((await (await run(req('/me', { origin: SITE, cookie }))).json()).loggedIn, true);
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600e3;
  try {
    const started = performance.now();
    assert.equal((await (await run(req('/me', { origin: SITE, cookie }))).json()).loggedIn, false);
    assert.ok(performance.now() - started < 250, 'no wait for a parallel refresh');
  } finally {
    Date.now = realNow;
  }
  const refreshes = sh.calls.filter(
    (c) => c.url?.endsWith('/oauth/token') && new URLSearchParams(c.init.body).get('grant_type') === 'refresh_token',
  );
  assert.equal(refreshes.length, 0);
  assert.equal(sessionKeys(memory).length, 0);
});

test('a refresh refused for a setup reason (invalid_client) keeps the session and answers an error', async () => {
  const { memory, cookie, sh } = await loginFlow();
  const misconfigured = async (url, init) => {
    if (String(url).endsWith('/oauth/token')) {
      return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
    }
    return sh.fetch(url, init);
  };
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600e3;
  try {
    const res = await handleAccount(req('/me', { origin: SITE, cookie }), env, { fetch: misconfigured, memory });
    assert.equal(res.status, 502);
  } finally {
    Date.now = realNow;
  }
  assert.equal(sessionKeys(memory).length, 1, 'the customer stays logged in');
});

test('discovery falls back to the shop id only for bot protection, not for a store domain that is down', async () => {
  const sh = shopify();
  const asked = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    asked.push(u);
    if (u.startsWith('https://down.myshopify.com/.well-known/')) return new Response('bad gateway', { status: 502 });
    return sh.fetch(url, init);
  };
  const r = await handleAccount(
    req('/login'),
    { ...env, SHOPIFY_DOMAIN: 'down.myshopify.com' },
    { fetch, memory: new Map() },
  );
  assert.equal(r.headers.get('location'), `${SITE}/?account=error`);
  assert.ok(!asked.some((u) => u.includes('/api/')), 'no shop id lookup');
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
  for (const name of Object.keys(ops)) {
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

test('logout with KV down still clears the cookie, and logs why Shopify is not logged out', async () => {
  const { cookie } = await loginFlow();
  const down = () => Promise.reject(new Error('KV unavailable'));
  const TETHER_SYNC = { get: down, put: down, delete: down };
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const res = await handleAccount(req('/logout', { method: 'POST', origin: SITE, cookie, body: {} }), {
      ...env,
      TETHER_SYNC,
    });
    assert.equal(res.status, 200);
    assert.match(cookiesOf(res).join(), /__Host-tether-account=; .*Max-Age=0/);
    assert.equal((await res.json()).logoutUrl, null);
  } finally {
    console.error = realError;
  }
  assert.ok(logged.some((line) => /session not read, so Shopify is not logged out.*KV unavailable/.test(line)));
});

test('logout step 2 with Shopify unreachable goes back to the site and logs that Shopify is not logged out', async () => {
  const { seal } = await import('../src/crypto.ts');
  const ticket = { idToken: 'header.payload.signature', returnTo: `${SITE}/bye`, at: Date.now() };
  const sealed = await seal(env.ACCOUNT_SECRET, 'logout', '__Host-tether-logout', ticket);
  const unreachable = async () => new Response('down', { status: 503 });
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  let go;
  try {
    go = await handleAccount(
      req('/logout/go', { cookie: `__Host-tether-logout=${sealed}` }),
      { ...env, SHOPIFY_DOMAIN: 'logout-down.myshopify.com' },
      { fetch: unreachable, memory: new Map() },
    );
  } finally {
    console.error = realError;
  }
  assert.equal(go.headers.get('location'), `${SITE}/bye`);
  assert.ok(logged.some((line) => /Shopify not logged out/.test(line)));
});
