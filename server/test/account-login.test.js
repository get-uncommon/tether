// Customer login through the Worker: the PKCE redirect, the callback, discovery of Shopify's endpoints, the id
// token's checks, and the attacks on them the Worker has to refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE } from '../src/account.ts';
import {
  SITE,
  WORKER,
  env,
  shopify,
  req,
  location,
  cookiesOf,
  pick,
  answer,
  loginFlow,
  sessionKeys,
  loginFrom,
} from './account-fixtures.js';

/** @typedef {typeof globalThis.fetch} Fetch */

test('login: PKCE redirect, pending login sealed in a cookie (nothing in KV), then a session cookie only', async () => {
  const { start, authorize, back, cookie, loginCookie, memory } = await loginFlow();
  assert.equal(start.status, 302);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${WORKER}${BASE}/callback`);
  assert.match(
    cookiesOf(start)[0] ?? '',
    /^__Host-tether-login=[\w.-]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/,
  );
  const state = authorize.searchParams.get('state');
  assert.ok(state);
  assert.ok(!loginCookie.includes(state), 'sealed, not readable');
  assert.equal(back.status, 302);
  assert.match(location(back), /^https:\/\/shop\.example\/account\?account=in$/);
  const set = cookiesOf(back).join('\n');
  assert.match(set, /__Host-tether-account=[\w-]{40,}; Path=\/; Secure; HttpOnly; SameSite=Lax/);
  assert.match(set, /__Host-tether-login=; .*Max-Age=0/, 'login cookie cleared');
  assert.ok(!/access-1|refresh-1/.test(set), 'no token in cookies');
  const stored = [...memory.values()].map((entry) => entry.value).join(' ');
  assert.equal(memory.size, 1, 'only the session in KV');
  assert.ok(!/access-1|refresh-1|eyJ/.test(stored), 'tokens are encrypted at rest');
  const sessionId = cookie.split('=')[1];
  assert.ok(sessionId);
  assert.ok(![...memory.keys()].some((key) => key.includes(sessionId)), 'the session id itself is not a key');
});

test('login CSRF: a callback without the login cookie of this browser is refused (attacker code + state)', async () => {
  const sh = shopify();
  const memory = new Map();
  /** @param {Request} request */
  const run = (request) => answer(request, env, { fetch: sh.fetch, memory });
  const attacker = await run(req('/login'));
  const attackerLogin = new URL(location(attacker));
  sh.setNonce(attackerLogin.searchParams.get('nonce'));
  // The attacker keeps their own code+state and sends the victim to the callback, without their cookie.
  const victim = await run(req(`/callback?code=attacker-code&state=${attackerLogin.searchParams.get('state')}`));
  assert.ok(!pick(victim, '__Host-tether-account'), 'no session for the victim');
  assert.match(location(victim), /account=expired/);
  // Or with a login cookie of another login (the victim's own): states differ, refused.
  const own = await run(req('/login'));
  const wrong = await run(
    req(`/callback?code=attacker-code&state=${attackerLogin.searchParams.get('state')}`, {
      cookie: pick(own, '__Host-tether-login'),
    }),
  );
  assert.ok(!pick(wrong, '__Host-tether-account'));
  assert.equal(memory.size, 0, 'and anonymous /login never writes to KV');
});

test('a tampered or wrong id token gets no session, and the visitor lands on the site with account=error', async () => {
  const inAnHour = Math.floor(Date.now() / 1000) + 3600;
  /** @type {import('./account-fixtures.js').ShopifyOptions[]} */
  const attacks = [
    { tamper: true },
    { wrongNonce: true },
    { kid: null },
    { kid: 'unknown-key' },
    { claims: { iat: inAnHour } },
    { claims: { nbf: inAnHour } },
  ];
  for (const attack of attacks) {
    const { back, memory } = await loginFlow(attack);
    assert.ok(!pick(back, '__Host-tether-account'), JSON.stringify(attack));
    assert.equal(back.status, 302, JSON.stringify(attack));
    assert.equal(location(back), `${SITE}/?account=error`);
    assert.match(cookiesOf(back).join('\n'), /__Host-tether-login=; .*Max-Age=0/, 'login cookie cleared');
    assert.equal(memory.size, 0);
  }
});

test('a token answer whose id_token is not a string fails the login instead of crashing', async () => {
  /**
   * @param {Fetch} inner
   * @returns {Fetch}
   */
  const wrapFetch = (inner) => async (url, init) => {
    if (!String(url).endsWith('/oauth/token')) return inner(url, init);
    return new Response(JSON.stringify({ access_token: 'access-1', id_token: 42, expires_in: 3600 }), { status: 200 });
  };
  const { back } = await loginFlow({ wrapFetch });
  assert.equal(location(back), `${SITE}/?account=error`);
  assert.ok(!pick(back, '__Host-tether-account'));
});

test('a login callback older than ten minutes is refused as expired, back where the login started', async () => {
  const flow = await loginFlow();
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60e3;
  try {
    const late = await flow.run(req(flow.callbackPath, { cookie: flow.loginCookie }));
    assert.ok(!pick(late, '__Host-tether-account'));
    assert.equal(location(late), `${SITE}/account?account=expired`);
  } finally {
    Date.now = realNow;
  }
});

test('a replayed callback with the same login cookie gets no session: Shopify refuses the spent code', async () => {
  const spent = new Set();
  /**
   * @param {Fetch} inner
   * @returns {Fetch}
   */
  const wrapFetch = (inner) => async (url, init) => {
    if (String(url).endsWith('/oauth/token')) {
      const body = init?.body;
      assert.ok(body instanceof URLSearchParams, 'a form body');
      const code = body.get('code');
      if (spent.has(code)) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      spent.add(code);
    }
    return inner(url, init);
  };
  const flow = await loginFlow({ wrapFetch });
  assert.ok(flow.cookie, 'the first callback logs in');
  const replay = await flow.run(req(flow.callbackPath, { cookie: flow.loginCookie }));
  assert.ok(!pick(replay, '__Host-tether-account'));
  assert.equal(location(replay), `${SITE}/?account=error`);
  assert.equal(sessionKeys(flow.memory).length, 1, 'only the first session exists');
});

test('a returnTo on another site lands on the shop instead (no open redirect)', async () => {
  const sh = shopify();
  const memory = new Map();
  /** @param {Request} request */
  const run = (request) => answer(request, env, { fetch: sh.fetch, memory });
  const evil = await run(req(`/login?returnTo=${encodeURIComponent('https://evil.example/steal')}`));
  const authorize = new URL(location(evil));
  sh.setNonce(authorize.searchParams.get('nonce'));
  const landed = await run(
    req(`/callback?code=c&state=${authorize.searchParams.get('state')}`, { cookie: pick(evil, '__Host-tether-login') }),
  );
  assert.match(location(landed), /^https:\/\/shop\.example\//);
});

test('a login from the longest address returnTo accepts fits in its cookie and comes back there', async () => {
  const returnTo = `${SITE}/collections/all?filter=${'a'.repeat(2047 - `${SITE}/collections/all?filter=`.length)}`;
  assert.equal(returnTo.length, 2047);
  const { loginCookie, landed, warned } = await loginFrom(returnTo);
  assert.ok(loginCookie.length < 4096, 'browsers keep the cookie');
  assert.equal(landed, `${returnTo}&account=in`);
  assert.deepEqual(warned, []);
});

test('a login from an address too long for its cookie comes back to the home page, and says why', async () => {
  // A backslash stays as it is in a URL's query, and doubles when the pending login is written as JSON.
  const { loginCookie, landed, warned } = await loginFrom(`${SITE}/search?q=${'\\'.repeat(2000)}`);
  assert.ok(loginCookie.length < 4096, 'browsers keep the cookie');
  assert.equal(landed, `${SITE}/?account=in`);
  assert.ok(warned.some((line) => /account login: the page's address .* too long to keep in a cookie/.test(line)));
});

test('a cookie longer than any the Worker sets reads as absent, not as its first part', async () => {
  const { loginCookie, callbackPath } = await loginFlow();
  const overLong = `${loginCookie}${'A'.repeat(4000)}`;
  const landed = await answer(req(callbackPath, { cookie: overLong }), env, { memory: new Map() });
  assert.equal(new URL(location(landed)).searchParams.get('account'), 'expired');
});

test('a new login ends the session the browser already had', async () => {
  const memory = new Map();
  const first = await loginFlow({ memory });
  const second = await loginFlow({ memory, sessionCookie: first.cookie });
  assert.ok(second.cookie && second.cookie !== first.cookie);
  assert.equal(sessionKeys(memory).length, 1);
  /** @param {string} cookie */
  const me = (cookie) => second.run(req('/me', { origin: SITE, cookie }));
  assert.equal((await (await me(first.cookie)).json()).loggedIn, false);
  assert.equal((await (await me(second.cookie)).json()).loggedIn, true);
});

test('the store domain refuses Workers (403 on .well-known): addresses come from the shop id instead', async () => {
  const sh = shopify();
  const blocked = { ...env, SHOPIFY_DOMAIN: 'blocked.myshopify.com' };
  /** @type {string[]} */
  const asked = [];
  /** @type {Fetch} */
  const fetch = async (url, init = {}) => {
    const target = String(url);
    asked.push(target);
    if (target.startsWith('https://blocked.myshopify.com/.well-known/'))
      return new Response('forbidden', { status: 403 });
    if (target.startsWith('https://blocked.myshopify.com/api/')) {
      assert.ok(typeof init.body === 'string', 'a JSON body');
      assert.match(JSON.parse(init.body).query, /shop \{ id \}/);
      return new Response(JSON.stringify({ data: { shop: { id: 'gid://shopify/Shop/1' } } }), { status: 200 });
    }
    return sh.fetch(url, init);
  };
  const memory = new Map();
  /** @param {Request} request */
  const run = (request) => answer(request, blocked, { fetch, memory });
  const start = await run(req('/login'));
  assert.equal(start.status, 302);
  const authorize = new URL(location(start));
  assert.equal(authorize.origin + authorize.pathname, 'https://shopify.com/authentication/1/oauth/authorize');
  assert.ok(asked.includes('https://shopify.com/authentication/1/.well-known/openid-configuration'));
  sh.setNonce(authorize.searchParams.get('nonce'));
  const back = await run(
    req(`/callback?code=c&state=${authorize.searchParams.get('state')}`, {
      cookie: pick(start, '__Host-tether-login'),
    }),
  );
  const cookie = pick(back, '__Host-tether-account');
  assert.ok(cookie, 'logged in');
  const me = await run(req('/me', { origin: SITE, cookie }));
  assert.equal((await me.json()).customer.firstName, 'Ada');
  assert.ok(
    asked.some((address) => address.startsWith('https://shopify.com/1/account/customer/api/')),
    'the Customer Account API by shop id',
  );
});

test('a cancelled login lands where it started with account=error; a state mismatch is an error too', async () => {
  const sh = shopify();
  const memory = new Map();
  /** @param {Request} request */
  const run = (request) => answer(request, env, { fetch: sh.fetch, memory });
  const realError = console.error;
  console.error = () => {};
  try {
    const start = await run(req(`/login?returnTo=${encodeURIComponent(`${SITE}/account`)}`));
    const state = new URL(location(start)).searchParams.get('state');
    const loginCookie = pick(start, '__Host-tether-login');
    const cancelled = await run(req(`/callback?error=access_denied&state=${state}`, { cookie: loginCookie }));
    assert.equal(location(cancelled), `${SITE}/account?account=error`);
    assert.match(cookiesOf(cancelled).join(), /__Host-tether-login=; .*Max-Age=0/);
    const otherTab = await run(req('/callback?code=c&state=another-tabs-state', { cookie: loginCookie }));
    assert.equal(location(otherTab), `${SITE}/?account=error`);
  } finally {
    console.error = realError;
  }
  assert.equal(memory.size, 0);
});

test('id token claims: iat and sub must be there, times must be numbers, azp must name us with several audiences', async () => {
  /** @type {[Record<string, unknown>, string][]} */
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
      assert.equal(location(back), `${SITE}/?account=error`, label);
    }
    const { back } = await loginFlow({ claims: { aud: ['client-1', 'someone-else'], azp: 'client-1' } });
    assert.match(location(back), /account=in/, 'several audiences with our azp');
  } finally {
    console.error = realError;
  }
});

test('discovery: when Shopify answers neither on the store domain nor on its account host, login fails closed', async () => {
  const sh = shopify();
  /** @type {Fetch} */
  const fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('/.well-known/')) return new Response('forbidden', { status: 403 });
    if (target.startsWith('https://closed.myshopify.com/api/')) {
      return new Response(JSON.stringify({ data: { shop: { id: 'gid://shopify/Shop/9' } } }), { status: 200 });
    }
    return sh.fetch(url, init);
  };
  const login = await answer(
    req('/login'),
    { ...env, SHOPIFY_DOMAIN: 'closed.myshopify.com' },
    {
      fetch,
      memory: new Map(),
    },
  );
  assert.equal(location(login), `${SITE}/?account=error`, 'no login is started against guessed endpoints');
  assert.equal(pick(login, '__Host-tether-login'), '__Host-tether-login=', 'and no pending login');
});

test('discovery falls back to the shop id only for bot protection, not for a store domain that is down', async () => {
  const sh = shopify();
  /** @type {string[]} */
  const asked = [];
  /** @type {Fetch} */
  const fetch = async (url, init = {}) => {
    const target = String(url);
    asked.push(target);
    if (target.startsWith('https://down.myshopify.com/.well-known/'))
      return new Response('bad gateway', { status: 502 });
    return sh.fetch(url, init);
  };
  const login = await answer(
    req('/login'),
    { ...env, SHOPIFY_DOMAIN: 'down.myshopify.com' },
    { fetch, memory: new Map() },
  );
  assert.equal(location(login), `${SITE}/?account=error`);
  assert.ok(!asked.some((address) => address.includes('/api/')), 'no shop id lookup');
});
