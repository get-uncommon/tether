// Customer accounts through the Worker: the safe mode. A simulated Shopify that signs id tokens
// with a real RSA key, and the attacks the Worker has to refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAccount, BASE } from '../src/account.js';

const SHOP = 'shop.myshopify.com';
const SITE = 'https://shop.example';
const WORKER = 'https://shop.example'; // a route on the shop's own domain
const env = {
  ACCOUNT_CLIENT_ID: 'client-1', ACCOUNT_ORIGINS: SITE, SHOPIFY_DOMAIN: SHOP,
  STOREFRONT_TOKEN: 'public-token', SYNC_SECRET: 'a-long-sync-secret-of-24-plus-chars',
};
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
async function idToken(claims, { tamper = false } = {}) {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const p = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`)));
  if (tamper) sig[5] ^= 1;
  return `${h}.${p}.${b64url(sig)}`;
}

function shopify({ tamper = false, wrongNonce = false } = {}) {
  const calls = [];
  let lastNonce = null;
  const fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const ok = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/.well-known/openid-configuration')) {
      return ok({ issuer: 'https://shopify.com/authentication/1', authorization_endpoint: 'https://shopify.com/authentication/1/oauth/authorize', token_endpoint: 'https://shopify.com/authentication/1/oauth/token', end_session_endpoint: 'https://shopify.com/authentication/1/logout', jwks_uri: 'https://shopify.com/authentication/1/.well-known/jwks.json' });
    }
    if (u.endsWith('/.well-known/customer-account-api')) return ok({ graphql_api: 'https://shopify.com/1/account/customer/api/2026-10/graphql' });
    if (u.endsWith('/jwks.json')) return ok({ keys: [jwk] });
    if (u.endsWith('/oauth/token')) {
      const body = new URLSearchParams(init.body);
      assert.equal(init.headers.Origin, SITE, 'the site origin, as Shopify expects');
      if (body.get('grant_type') === 'refresh_token') return ok({ access_token: 'access-2', expires_in: 3600 });
      const token = await idToken({ iss: 'https://shopify.com/authentication/1', aud: 'client-1', nonce: wrongNonce ? 'other' : lastNonce, exp: Math.floor(Date.now() / 1000) + 3600 }, { tamper });
      return ok({ access_token: 'access-1', refresh_token: 'refresh-1', id_token: token, expires_in: 3600 });
    }
    if (u.includes('/account/customer/api/')) {
      const q = JSON.parse(init.body).query;
      if (/TetherOrders/.test(q)) return ok({ data: { customer: { orders: { nodes: [{ id: 'o1', name: '#1001', totalPrice: { amount: '10.0', currencyCode: 'EUR' } }] } } } });
      return ok({ data: { customer: { id: 'c1', firstName: 'Ada', lastName: 'L', displayName: 'Ada L', emailAddress: { emailAddress: 'ada@x.test' }, defaultAddress: null } } });
    }
    if (u.includes(`${SHOP}/api/`)) return ok({ data: { cartBuyerIdentityUpdate: { cart: { checkoutUrl: 'https://shop.example/checkouts/c/1' }, userErrors: [] } } });
    throw new Error(`unexpected ${u}`);
  };
  return { fetch, calls, setNonce: (n) => { lastNonce = n; } };
}

const req = (path, { method = 'GET', origin, cookie, body, header = true } = {}) => new Request(`${WORKER}${BASE}${path}`, {
  method,
  headers: { ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' && header ? { 'X-Tether-Account': '1', 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const cookiesOf = (res) => (res.headers.getSetCookie?.() || [res.headers.get('set-cookie')].filter(Boolean));
const pick = (res, name) => (cookiesOf(res).find((c) => c.startsWith(`${name}=`)) || '').split(';')[0];

async function loginFlow(opts = {}) {
  const sh = shopify(opts);
  const memory = new Map();
  const run = (r) => handleAccount(r, env, { fetch: sh.fetch, memory });
  const start = await run(req(`/login?returnTo=${encodeURIComponent(`${SITE}/account`)}`));
  const authorize = new URL(start.headers.get('location'));
  sh.setNonce(authorize.searchParams.get('nonce'));
  const loginCookie = pick(start, '__Host-tether-login');
  const back = await run(req(`/callback?code=the-code&state=${authorize.searchParams.get('state')}`, { cookie: loginCookie }));
  return { sh, memory, run, start, authorize, back, loginCookie, cookie: pick(back, '__Host-tether-account') };
}

test('login: PKCE redirect, pending login sealed in a cookie (nothing in KV), then a session cookie only', async () => {
  const { start, authorize, back, cookie, loginCookie, memory } = await loginFlow();
  assert.equal(start.status, 302);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${WORKER}${BASE}/callback`);
  assert.match(cookiesOf(start)[0], /^__Host-tether-login=[\w.-]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
  assert.ok(!loginCookie.includes(authorize.searchParams.get('state')), 'sealed, not readable');
  assert.equal(back.status, 302);
  assert.match(back.headers.get('location'), /^https:\/\/shop\.example\/account\?account=in$/);
  const set = cookiesOf(back).join('\n');
  assert.match(set, /__Host-tether-account=[\w-]{40,}; Path=\/; Secure; HttpOnly; SameSite=Lax/);
  assert.match(set, /__Host-tether-login=; .*Max-Age=0/, 'login cookie cleared');
  assert.ok(!/access-1|refresh-1/.test(set), 'no token in cookies');
  const stored = [...memory.values()].map((e) => e.v).join(' ');
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
  const wrong = await run(req(`/callback?code=attacker-code&state=${a.searchParams.get('state')}`, { cookie: pick(own, '__Host-tether-login') }));
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
  assert.equal((await (await run(req('/orders?first=5', { origin: SITE, cookie }))).json()).orders[0].name, '#1001');
  const same = new Request(`${WORKER}${BASE}/me`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal((await (await run(same)).json()).loggedIn, true, 'same-origin GET without Origin');
  const cross = new Request(`${WORKER}${BASE}/me`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal((await run(cross)).status, 403);
  assert.equal((await run(req('/me', { origin: 'https://evil.example', cookie }))).status, 403);
  assert.equal((await run(req('/me', { cookie }))).status, 403);
  assert.equal((await (await run(req('/me', { origin: SITE }))).json()).loggedIn, false);
});

test('attacks: tampered or wrong id token, replay, missing CSRF header, open redirect, moved KV blobs', async () => {
  for (const opts of [{ tamper: true }, { wrongNonce: true }]) {
    const { back } = await loginFlow(opts);
    assert.ok(!pick(back, '__Host-tether-account'), JSON.stringify(opts));
    assert.equal(back.status, 502);
  }
  const ok = await loginFlow();
  // the login cookie is cleared at the callback; replaying with it a second time: Shopify's code is
  // single-use anyway, and a stale login cookie (> 10 min) is refused
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60e3;
  try {
    const late = await ok.run(req(`/callback?code=the-code&state=${ok.authorize.searchParams.get('state')}`, { cookie: ok.loginCookie }));
    assert.ok(!pick(late, '__Host-tether-account'), 'expired login refused');
  } finally { Date.now = realNow; }
  assert.equal((await ok.run(req('/cart', { method: 'POST', origin: SITE, cookie: ok.cookie, body: { cartId: 'gid://shopify/Cart/abc' }, header: false }))).status, 400);
  // returnTo on another site: back to the shop instead
  const sh = shopify();
  const memory = new Map();
  const evil = await handleAccount(req(`/login?returnTo=${encodeURIComponent('https://evil.example/steal')}`), env, { fetch: sh.fetch, memory });
  const u = new URL(evil.headers.get('location'));
  sh.setNonce(u.searchParams.get('nonce'));
  const landed = await handleAccount(req(`/callback?code=c&state=${u.searchParams.get('state')}`, { cookie: pick(evil, '__Host-tether-login') }), env, { fetch: sh.fetch, memory });
  assert.match(landed.headers.get('location'), /^https:\/\/shop\.example\//);
  // a sealed session moved to another KV key doesn't open
  const [k, e] = [...ok.memory.entries()][0];
  ok.memory.set('s:other', e);
  ok.memory.delete(k);
  const moved = await ok.run(new Request(`${WORKER}${BASE}/me`, { headers: { Cookie: ok.cookie, Origin: SITE } }));
  assert.equal((await moved.json()).loggedIn, false);
});

test('cart link, refresh, absolute lifetime, a 401 from Shopify ends the session', async () => {
  const { run, cookie, sh, memory } = await loginFlow();
  const linked = await (await run(req('/cart', { method: 'POST', origin: SITE, cookie, body: { cartId: 'gid://shopify/Cart/abc?key=k1' } }))).json();
  assert.equal(linked.linked, true);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 2 * 3600e3;
    assert.equal((await (await run(req('/me', { origin: SITE, cookie }))).json()).loggedIn, true);
    assert.ok(sh.calls.some((c) => c.url.endsWith('/oauth/token') && new URLSearchParams(c.init.body).get('grant_type') === 'refresh_token'));
    Date.now = () => realNow() + 15 * 86400e3; // past the 14-day lifetime, even though it was in use
    assert.equal((await (await run(req('/me', { origin: SITE, cookie }))).json()).loggedIn, false);
    assert.equal(memory.size, 0);
  } finally { Date.now = realNow; }
});

test('logout never fails open: session ended and cookie cleared even when Shopify is down; id token never in the answer', async () => {
  const { run, cookie, memory, sh } = await loginFlow();
  const down = async (url, init) => (/well-known|oauth\/token/.test(String(url)) ? new Response('down', { status: 503 }) : sh.fetch(url, init));
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600e3; // access expired, and refresh would fail
  let res;
  try {
    res = await handleAccount(req('/logout', { method: 'POST', origin: SITE, cookie, body: { returnTo: `${SITE}/bye`, cartId: 'gid://shopify/Cart/abc?key=k1' } }), env, { fetch: down, memory });
  } finally { Date.now = realNow; }
  assert.equal(res.status, 200);
  assert.match(pick(res, '__Host-tether-account') + cookiesOf(res).join(), /Max-Age=0/);
  assert.equal(memory.size, 0, 'session deleted');
  const body = await res.json();
  assert.equal(body.loggedOut, true);
  assert.ok(!JSON.stringify(body).includes('eyJ'), 'no id token for scripts');
  assert.equal(body.logoutUrl, `${WORKER}${BASE}/logout/go`);
  // step 2: the one-time cookie carries the id token to Shopify's logout
  const go = await run(req('/logout/go', { cookie: pick(res, '__Host-tether-logout') }));
  assert.match(go.headers.get('location'), /\/logout\?id_token_hint=.+&post_logout_redirect_uri=https%3A%2F%2Fshop\.example%2Fbye/);
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
  const rotating = async (url, init) => {
    if (String(url).endsWith('/oauth/token') && new URLSearchParams(init.body).get('grant_type') === 'refresh_token') {
      await new Promise((r) => setTimeout(r, rotated ? 0 : 5));
      if (rotated) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }); // the old refresh token is spent
      rotated = true;
      return new Response(JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }), { status: 200 });
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
  } finally { Date.now = realNow; }
});

test('a 401 from Shopify (session ended there) ends it here too', async () => {
  const { memory, cookie, sh } = await loginFlow();
  const ended = async (url, init) => (String(url).includes('/account/customer/api/') ? new Response('{}', { status: 401 }) : sh.fetch(url, init));
  const r = await handleAccount(req('/me', { origin: SITE, cookie }), env, { fetch: ended, memory });
  assert.equal((await r.json()).loggedIn, false);
  assert.equal(memory.size, 0);
});
