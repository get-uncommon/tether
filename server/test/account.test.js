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

async function loginFlow(opts = {}) {
  const sh = shopify(opts);
  const memory = new Map();
  const run = (r) => handleAccount(r, env, { fetch: sh.fetch, memory });
  const start = await run(req(`/login?returnTo=${encodeURIComponent(`${SITE}/account`)}&cart=${encodeURIComponent('gid://shopify/Cart/abc?key=k1')}`));
  const authorize = new URL(start.headers.get('location'));
  sh.setNonce(authorize.searchParams.get('nonce'));
  const back = await run(req(`/callback?code=the-code&state=${authorize.searchParams.get('state')}`));
  return { sh, memory, run, start, authorize, back, cookie: (back.headers.get('set-cookie') || '').split(';')[0] };
}

test('login: PKCE redirect to Shopify, then a session cookie only (HttpOnly, Secure, __Host-)', async () => {
  const { start, authorize, back, cookie, memory, sh } = await loginFlow();
  assert.equal(start.status, 302);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${WORKER}${BASE}/callback`);
  assert.equal(back.status, 302);
  assert.match(back.headers.get('location'), /^https:\/\/shop\.example\/account\?account=in$/);
  const set = back.headers.get('set-cookie');
  assert.match(set, /^__Host-tether-account=[\w-]{40,};/);
  for (const flag of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax']) assert.ok(set.includes(flag), flag);
  assert.ok(!/access-1|refresh-1/.test(set), 'no token in the cookie');
  // KV: encrypted, keyed by a hash of the session id
  const stored = [...memory.values()].map((e) => e.v).join(' ');
  assert.ok(!/access-1|refresh-1|eyJ/.test(stored), 'tokens are encrypted at rest');
  assert.ok(![...memory.keys()].some((k) => k.includes(cookie.split('=')[1])), 'the session id itself is not a key');
  assert.ok(sh.calls.some((c) => c.url.includes(`${SHOP}/api/`)), 'the cart from login was linked');
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
  // same-origin GET without an Origin header (the Worker on the site's domain): allowed
  const same = new Request(`${WORKER}${BASE}/me`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal((await (await run(same)).json()).loggedIn, true);
  const cross = new Request(`${WORKER}${BASE}/me`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal((await run(cross)).status, 403);
  // another site, or no Origin: refused
  assert.equal((await run(req('/me', { origin: 'https://evil.example', cookie }))).status, 403);
  assert.equal((await run(req('/me', { cookie }))).status, 403);
  // no cookie: logged out
  assert.equal((await (await run(req('/me', { origin: SITE }))).json()).loggedIn, false);
});

test('attacks: wrong state, tampered or wrong id token, missing CSRF header, open redirect', async () => {
  // a state Shopify didn't get from us
  const sh = shopify();
  const memory = new Map();
  const forged = await handleAccount(req('/callback?code=x&state=made-up'), env, { fetch: sh.fetch, memory });
  assert.equal(forged.status, 302);
  assert.ok(!forged.headers.get('set-cookie'));
  // tampered signature / wrong nonce: no session
  for (const opts of [{ tamper: true }, { wrongNonce: true }]) {
    const { back } = await loginFlow(opts);
    assert.ok(!back.headers.get('set-cookie'), JSON.stringify(opts));
    assert.equal(back.status, 502);
  }
  // state is single-use
  const ok = await loginFlow();
  const again = await ok.run(req(`/callback?code=the-code&state=${ok.authorize.searchParams.get('state')}`));
  assert.ok(!again.headers.get('set-cookie'), 'replayed callback refused');
  // POST without the custom header (a plain form from another site): refused
  assert.equal((await ok.run(req('/cart', { method: 'POST', origin: SITE, cookie: ok.cookie, body: { cartId: 'gid://shopify/Cart/abc' }, header: false }))).status, 400);
  // returnTo on another site: back to the shop instead
  const evil = await handleAccount(req(`/login?returnTo=${encodeURIComponent('https://evil.example/steal')}`), env, { fetch: sh.fetch, memory });
  const st = new URL(evil.headers.get('location')).searchParams.get('state');
  sh.setNonce(new URL(evil.headers.get('location')).searchParams.get('nonce'));
  const landed = await handleAccount(req(`/callback?code=c&state=${st}`), env, { fetch: sh.fetch, memory });
  assert.match(landed.headers.get('location'), /^https:\/\/shop\.example\//);
});

test('cart link, token refresh, logout', async () => {
  const { run, cookie, memory, sh } = await loginFlow();
  const linked = await (await run(req('/cart', { method: 'POST', origin: SITE, cookie, body: { cartId: 'gid://shopify/Cart/abc?key=k1' } }))).json();
  assert.equal(linked.linked, true);
  // expire the access token: the next call refreshes on the server
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 3600e3;
  try {
    const me = await (await run(req('/me', { origin: SITE, cookie }))).json();
    assert.equal(me.loggedIn, true);
    assert.ok(sh.calls.some((c) => c.url.endsWith('/oauth/token') && new URLSearchParams(c.init.body).get('grant_type') === 'refresh_token'));
  } finally { Date.now = realNow; }
  const out = await run(req('/logout', { method: 'POST', origin: SITE, cookie, body: { returnTo: `${SITE}/bye` } }));
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  const { logoutUrl } = await out.json();
  assert.match(logoutUrl, /\/logout\?id_token_hint=.+&post_logout_redirect_uri=https%3A%2F%2Fshop\.example%2Fbye/);
  assert.equal((await (await run(req('/me', { origin: SITE, cookie }))).json()).loggedIn, false, 'session gone on the server');
});

test('settings: not set up -> 404; missing pieces -> 503 with what to fix', async () => {
  assert.equal((await handleAccount(req('/me'), {}, {})).status, 404);
  const r = await handleAccount(req('/me'), { ACCOUNT_CLIENT_ID: 'x', SHOPIFY_DOMAIN: SHOP }, {});
  assert.equal(r.status, 503);
  assert.match(JSON.stringify(await r.json()), /ACCOUNT_ORIGINS|SYNC_SECRET/);
  assert.equal(await handleAccount(new Request('https://x/other'), env, {}), null, 'other routes pass through');
});
