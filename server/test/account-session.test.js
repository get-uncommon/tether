// Customer sessions in the Worker: sealing, refresh, the cart link, expiry, and logout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE } from '../src/account.ts';
import {
  SITE,
  WORKER,
  env,
  cookiesOf,
  req,
  location,
  pick,
  answer,
  loginFlow,
  sessionKeys,
} from './account-fixtures.js';

/** @typedef {typeof globalThis.fetch} Fetch */

test('a logout from an address too long for the ticket cookie still logs out of Shopify, back to the home page', async () => {
  const { run, cookie } = await loginFlow();
  const returnTo = `${SITE}/search?q=${'\\'.repeat(2000)}`;
  const realWarn = console.warn;
  console.warn = () => {};
  let res;
  try {
    res = await run(req('/logout', { method: 'POST', origin: SITE, cookie, body: { returnTo } }));
  } finally {
    console.warn = realWarn;
  }
  const { logoutUrl } = await res.json();
  assert.equal(logoutUrl, `${WORKER}${BASE}/logout/go`);
  const ticketCookie = pick(res, '__Host-tether-logout');
  assert.ok(ticketCookie.length < 4096, 'browsers keep the cookie');
  const go = await run(req('/logout/go', { cookie: ticketCookie }));
  assert.equal(new URL(location(go)).searchParams.get('post_logout_redirect_uri'), `${SITE}/`);
});

test("one session's sealed blob copied under another session's key does not open", async () => {
  const memory = new Map();
  const first = await loginFlow({ memory });
  const second = await loginFlow({ memory });
  const [firstKey, secondKey] = sessionKeys(memory);
  assert.ok(firstKey && secondKey && firstKey !== secondKey);
  memory.set(secondKey, memory.get(firstKey));
  /** @param {string} cookie */
  const me = (cookie) => first.run(req('/me', { origin: SITE, cookie }));
  assert.equal((await (await me(second.cookie)).json()).loggedIn, false, 'the copy is bound to the first key');
  assert.equal((await (await me(first.cookie)).json()).loggedIn, true, 'the original still opens');
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
        (call) =>
          call.url?.endsWith('/oauth/token') &&
          call.init?.body instanceof URLSearchParams &&
          call.init.body.get('grant_type') === 'refresh_token',
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
  /** @type {Fetch} */
  const down = async (url, init) =>
    /well-known|oauth\/token/.test(String(url)) ? new Response('down', { status: 503 }) : sh.fetch(url, init);
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600e3; // access expired, and refresh would fail
  let res;
  try {
    res = await answer(
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
  assert.match(location(go), /\/logout\?id_token_hint=.+&post_logout_redirect_uri=https%3A%2F%2Fshop\.example%2Fbye/);
  assert.match(cookiesOf(go).join(), /__Host-tether-logout=; .*Max-Age=0/);
  assert.equal((await (await run(req('/me', { origin: SITE, cookie }))).json()).loggedIn, false);
  void run;
});

test('refresh race: two requests refresh at once (Shopify rotates the refresh token): both stay logged in', async () => {
  const { memory, cookie, sh } = await loginFlow();
  let rotated = false;
  let refreshes = 0;
  /** @type {Fetch} */
  const rotating = async (url, init) => {
    const body = init?.body;
    if (
      String(url).endsWith('/oauth/token') &&
      body instanceof URLSearchParams &&
      body.get('grant_type') === 'refresh_token'
    ) {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, rotated ? 0 : 5));
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
    /** @param {string} path */
    const run = (path) => answer(req(path, { origin: SITE, cookie }), env, { fetch: rotating, memory });
    const [me, orders] = await Promise.all([run('/me'), run('/orders')]);
    assert.equal((await me.json()).loggedIn, true);
    assert.equal((await orders.json()).loggedIn, true, 'the loser uses the session the winner refreshed');
    assert.equal(refreshes, 1, 'requests in one isolate share one refresh');
  } finally {
    Date.now = realNow;
  }
});

test('a 401 from Shopify (session ended there) ends it here too', async () => {
  const { memory, cookie, sh } = await loginFlow();
  /** @type {Fetch} */
  const ended = async (url, init) =>
    String(url).includes('/account/customer/api/') ? new Response('{}', { status: 401 }) : sh.fetch(url, init);
  const me = await answer(req('/me', { origin: SITE, cookie }), env, { fetch: ended, memory });
  assert.equal((await me.json()).loggedIn, false);
  assert.equal(memory.size, 0);
  assert.match(cookiesOf(me).join(), /__Host-tether-account=; .*Max-Age=0/, 'the dead session cookie is cleared');
  const orders = await answer(req('/orders', { origin: SITE, cookie }), env, { fetch: ended, memory });
  assert.equal(orders.status, 401, 'data routes answer 401 without a session; /me answers 200');
  assert.deepEqual(await orders.json(), { loggedIn: false, orders: [] });
});

test('a session without a refresh token lasts as long as its access token, without asking Shopify again', async () => {
  /**
   * @param {Fetch} inner
   * @returns {Fetch}
   */
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
    (call) =>
      call.url?.endsWith('/oauth/token') &&
      call.init?.body instanceof URLSearchParams &&
      call.init.body.get('grant_type') === 'refresh_token',
  );
  assert.equal(refreshes.length, 0);
  assert.equal(sessionKeys(memory).length, 0);
});

test('a refresh refused for a setup reason (invalid_client) keeps the session and answers an error', async () => {
  const { memory, cookie, sh } = await loginFlow();
  /** @type {Fetch} */
  const misconfigured = async (url, init) => {
    if (String(url).endsWith('/oauth/token')) {
      return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
    }
    return sh.fetch(url, init);
  };
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600e3;
  try {
    const res = await answer(req('/me', { origin: SITE, cookie }), env, { fetch: misconfigured, memory });
    assert.equal(res.status, 502);
  } finally {
    Date.now = realNow;
  }
  assert.equal(sessionKeys(memory).length, 1, 'the customer stays logged in');
});

test('logout with KV down still clears the cookie, and logs why Shopify is not logged out', async () => {
  const { cookie } = await loginFlow();
  const down = () => Promise.reject(new Error('KV unavailable'));
  /** @type {import('../src/env.ts').KvBinding} */
  const TETHER_SYNC = { get: down, put: down, delete: down };
  /** @type {string[]} */
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const res = await answer(req('/logout', { method: 'POST', origin: SITE, cookie, body: {} }), {
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
  /** @type {string[]} */
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  let go;
  try {
    go = await answer(
      req('/logout/go', { cookie: `__Host-tether-logout=${sealed}` }),
      { ...env, SHOPIFY_DOMAIN: 'logout-down.myshopify.com' },
      { fetch: unreachable, memory: new Map() },
    );
  } finally {
    console.error = realError;
  }
  assert.equal(location(go), `${SITE}/bye`);
  assert.ok(logged.some((line) => /Shopify not logged out/.test(line)));
});
