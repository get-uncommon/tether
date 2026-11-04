/**
 * Customer accounts through the Worker (the safe mode): the visitor's browser never holds a Shopify
 * token. The Worker logs the customer in with Shopify's Customer Account API (OAuth + PKCE, the
 * id token's signature checked against Shopify's keys), keeps the tokens encrypted in KV, and gives
 * the browser only a session cookie that scripts can't read (__Host-, HttpOnly, Secure, SameSite=Lax).
 * The browser can ask for a fixed set of things: the profile, the orders, linking its cart, logout.
 *
 * Routes (the Worker must run on the shop's own domain, e.g. a route shop.com/_tether/*):
 *   GET  /_tether/account/login?returnTo=&cart=   to Shopify's login page
 *   GET  /_tether/account/callback               back from Shopify: session cookie, then returnTo
 *   GET  /_tether/account/me                     { loggedIn, customer }
 *   GET  /_tether/account/orders?first=10        { orders }
 *   POST /_tether/account/cart   { cartId }      links the cart to the customer, { checkoutUrl }
 *   POST /_tether/account/logout                 ends the session, { logoutUrl } (Shopify's logout)
 *
 * Settings (Worker secrets): ACCOUNT_CLIENT_ID (Headless channel → Customer Account API),
 * ACCOUNT_CLIENT_SECRET (only for a Confidential client), ACCOUNT_ORIGINS (the site, e.g.
 * https://shop.com, comma-separated), STOREFRONT_TOKEN (the public token, to link carts),
 * SHOPIFY_DOMAIN and SYNC_SECRET (already set; the session encryption key is derived from it).
 */

export const BASE = '/_tether/account';
const COOKIE = '__Host-tether-account';
const PENDING_TTL = 600; // seconds a login may take
const ORDER_QUERY = `query TetherOrders($first: Int!) { customer { orders(first: $first, sortKey: PROCESSED_AT, reverse: true) {
  nodes { id name processedAt financialStatus fulfillmentStatus statusPageUrl totalPrice { amount currencyCode }
    lineItems(first: 20) { nodes { title variantTitle quantity image { url altText } } } } } } }`;
const ME_QUERY = 'query TetherCustomer { customer { id firstName lastName displayName emailAddress { emailAddress } defaultAddress { formatted } } }';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

const val = (v) => {
  const t = String(v ?? '').trim();
  return t && !/^(none|-|null|undefined)$/i.test(t) ? t : '';
};

/** What's configured; null when accounts are off. */
export function accountSettings(env) {
  const clientId = val(env.ACCOUNT_CLIENT_ID);
  if (!clientId) return null;
  return {
    clientId,
    clientSecret: val(env.ACCOUNT_CLIENT_SECRET),
    origins: val(env.ACCOUNT_ORIGINS).split(/[\s,]+/).map((o) => o.replace(/\/$/, '')).filter(Boolean),
    shopDomain: val(env.SHOPIFY_DOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, ''),
    storefrontToken: val(env.STOREFRONT_TOKEN),
    secret: val(env.SYNC_SECRET),
    sessionDays: Math.max(1, Math.min(90, parseInt(val(env.ACCOUNT_SESSION_DAYS) || '14', 10) || 14)),
    apiVersion: val(env.STOREFRONT_API_VERSION) || '2026-07',
  };
}

/** Problems with the settings, for /check. Empty when it's good to go. */
export function accountProblems(s) {
  const p = [];
  if (!s.origins.length) p.push('ACCOUNT_ORIGINS is missing: your site, e.g. https://shop.com');
  if (s.origins.some((o) => !/^https:\/\/[^/]+$/.test(o))) p.push('ACCOUNT_ORIGINS must be https origins without a path, e.g. https://shop.com');
  if (!s.shopDomain) p.push('SHOPIFY_DOMAIN is missing');
  if (s.secret.length < 24) p.push('SYNC_SECRET (24+ characters) is needed: the session encryption key comes from it');
  if (!s.storefrontToken) p.push('STOREFRONT_TOKEN (the public Storefront token) is missing: carts can\'t be linked, so checkout won\'t know the customer');
  return p;
}

// ---------------------------------------------------------------- crypto

const keys = new Map();
async function aesKey(secret) {
  if (!keys.has(secret)) {
    const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
    keys.set(secret, await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('tether-account-v1'), info: enc.encode('session') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    ));
  }
  return keys.get(secret);
}
async function seal(secret, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(JSON.stringify(data)));
  return `${b64url(iv)}.${b64url(ct)}`;
}
async function open(secret, sealed) {
  if (!sealed) return null;
  try {
    const [iv, ct] = String(sealed).split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(secret), fromB64url(ct));
    return JSON.parse(dec.decode(pt));
  } catch { return null; }
}

// ---------------------------------------------------------------- KV (with expiry)

function kv(env, store) {
  if (env.TETHER_SYNC) {
    return {
      get: (k) => env.TETHER_SYNC.get(`tether-account:${k}`),
      put: (k, v, ttl) => env.TETHER_SYNC.put(`tether-account:${k}`, v, { expirationTtl: Math.max(60, ttl) }),
      delete: (k) => env.TETHER_SYNC.delete(`tether-account:${k}`),
    };
  }
  // Tests / Node: a memory store with expiry.
  const m = store || new Map();
  return {
    get: async (k) => { const e = m.get(k); if (!e) return null; if (e.until < Date.now()) { m.delete(k); return null; } return e.v; },
    put: async (k, v, ttl) => { m.set(k, { v, until: Date.now() + ttl * 1000 }); },
    delete: async (k) => { m.delete(k); },
  };
}

// ---------------------------------------------------------------- Shopify

const discoveryCache = new Map();
async function discover(s, fetchImpl) {
  const hit = discoveryCache.get(s.shopDomain);
  if (hit && hit.until > Date.now()) return hit.value;
  const get = async (p) => {
    const r = await fetchImpl(`https://${s.shopDomain}/.well-known/${p}`);
    if (!r.ok) throw new Error(`${p} answered ${r.status}`);
    return r.json();
  };
  const [oidc, api] = await Promise.all([get('openid-configuration'), get('customer-account-api')]);
  const value = { ...oidc, graphql: api.graphql_api };
  discoveryCache.set(s.shopDomain, { value, until: Date.now() + 3600e3 });
  return value;
}

const jwksCache = new Map();
/** The id token's RS256 signature, checked against Shopify's published keys. */
async function verifyIdToken(token, d, s, nonce, fetchImpl) {
  const [h, p, sig] = String(token || '').split('.');
  if (!sig) throw new Error('id token missing');
  const header = JSON.parse(dec.decode(fromB64url(h)));
  const claims = JSON.parse(dec.decode(fromB64url(p)));
  if (header.alg !== 'RS256') throw new Error(`id token alg ${header.alg}`);
  let set = jwksCache.get(d.jwks_uri);
  if (!set || !set.keys.some((k) => k.kid === header.kid)) {
    set = await (await fetchImpl(d.jwks_uri)).json();
    jwksCache.set(d.jwks_uri, set);
  }
  const jwk = set.keys.find((k) => k.kid === header.kid) || (set.keys.length === 1 ? set.keys[0] : null);
  if (!jwk) throw new Error('id token key not found');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(sig), enc.encode(`${h}.${p}`));
  const aud = [].concat(claims.aud || []);
  if (!ok) throw new Error('id token signature');
  if (claims.iss !== d.issuer) throw new Error('id token issuer');
  if (!aud.includes(s.clientId)) throw new Error('id token audience');
  if (claims.nonce !== nonce) throw new Error('id token nonce');
  if (!(claims.exp * 1000 > Date.now())) throw new Error('id token expired');
  return claims;
}

async function tokenRequest(s, d, params, origin, fetchImpl) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, 'User-Agent': 'tether-sync' };
  if (s.clientSecret) headers.Authorization = `Basic ${btoa(`${s.clientId}:${s.clientSecret}`)}`;
  const res = await fetchImpl(d.token_endpoint, { method: 'POST', headers, body: new URLSearchParams({ client_id: s.clientId, ...params }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const e = new Error(`token ${res.status} ${data.error || ''}`.trim());
    e.ended = res.status === 400 || res.status === 401;
    throw e;
  }
  return data;
}

async function customerQuery(s, d, access, query, variables, origin, fetchImpl) {
  const res = await fetchImpl(d.graphql, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: access, Origin: origin, 'User-Agent': 'tether-sync' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  if (!res.ok || json.errors?.length) throw new Error(json.errors?.map((x) => x.message).join(' | ') || `customer api ${res.status}`);
  return json.data;
}

async function linkCart(s, cartId, access, fetchImpl) {
  if (!s.storefrontToken || !cartId) return null;
  const res = await fetchImpl(`https://${s.shopDomain}/api/${s.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': s.storefrontToken },
    body: JSON.stringify({
      query: 'mutation L($id: ID!, $b: CartBuyerIdentityInput!) { cartBuyerIdentityUpdate(cartId: $id, buyerIdentity: $b) { cart { checkoutUrl } userErrors { message } } }',
      variables: { id: cartId, b: { customerAccessToken: access } },
    }),
  });
  const json = await res.json().catch(() => ({}));
  return json.data?.cartBuyerIdentityUpdate?.cart?.checkoutUrl || null;
}

// ---------------------------------------------------------------- HTTP

const readCookie = (req) => {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,100})`));
  return m ? m[1] : null;
};
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const SAFE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

function cors(req, s) {
  const origin = req.headers.get('origin');
  // Same-origin GETs (the Worker on the site's own domain) carry no Origin header; the browser marks
  // them with Sec-Fetch-Site, which pages can't set. Everything else needs an allowed Origin.
  if (!origin && req.headers.get('sec-fetch-site') === 'same-origin') {
    const host = new URL(req.url).origin;
    return s.origins.includes(host) ? { Vary: 'Origin' } : null;
  }
  if (!origin || !s.origins.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Tether-Account',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...SAFE, ...headers } });
const redirect = (to, headers = {}) => new Response(null, { status: 302, headers: { Location: to, ...SAFE, ...headers } });

/** A same-site return address from the allowed origins only (no open redirects). */
function safeReturn(raw, s) {
  try {
    const u = new URL(raw);
    if (s.origins.includes(u.origin) && u.href.length < 2048) return u.href;
  } catch { /* fall through */ }
  return `${s.origins[0]}/`;
}

/**
 * Handles /_tether/account/*. Returns a Response, or null when the path isn't an account route.
 * options: { fetch, memory } (tests).
 */
export async function handleAccount(request, env, { fetch: fetchImpl = globalThis.fetch, memory } = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${BASE}/`)) return null;
  const s = accountSettings(env);
  if (!s) return json({ error: 'accounts are not set up (ACCOUNT_CLIENT_ID)' }, 404);
  const problems = accountProblems(s).filter((p) => !/STOREFRONT_TOKEN/.test(p));
  if (problems.length) return json({ error: 'accounts are not set up', problems }, 503);
  const store = kv(env, memory);
  const route = url.pathname.slice(BASE.length);
  const callbackUrl = `${url.origin}${BASE}/callback`;
  const allow = cors(request, s);
  const siteOrigin = s.origins[0];

  if (request.method === 'OPTIONS') return allow ? new Response(null, { status: 204, headers: { ...allow, ...SAFE } }) : new Response(null, { status: 403 });

  // ---- session helpers
  const sid = readCookie(request);
  const sessionKey = async (id) => `s:${hex(await sha256(id))}`;
  const loadSession = async () => (sid ? open(s.secret, await store.get(await sessionKey(sid))) : null);
  const saveSession = async (id, data) => store.put(await sessionKey(id), await seal(s.secret, data), s.sessionDays * 86400);
  const freshAccess = async (sess) => {
    if (sess.expiresAt > Date.now() + 60e3) return sess;
    const d = await discover(s, fetchImpl);
    try {
      const t = await tokenRequest(s, d, { grant_type: 'refresh_token', refresh_token: sess.refresh }, siteOrigin, fetchImpl);
      const next = { ...sess, access: t.access_token, refresh: t.refresh_token || sess.refresh, idToken: t.id_token || sess.idToken, expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
      await saveSession(sid, next);
      return next;
    } catch (err) {
      if (err.ended) { await store.delete(await sessionKey(sid)); return null; }
      throw err;
    }
  };

  try {
    // ---- login: a top-level navigation from the site
    if (route === '/login' && request.method === 'GET') {
      const d = await discover(s, fetchImpl);
      const state = random();
      const nonce = random();
      const verifier = random();
      const returnTo = safeReturn(url.searchParams.get('returnTo') || request.headers.get('referer') || '', s);
      const cartId = /^gid:\/\/shopify\/Cart\/[\w-]+(\?key=[\w-]+)?$/.test(url.searchParams.get('cart') || '') ? url.searchParams.get('cart') : null;
      await store.put(`p:${hex(await sha256(state))}`, await seal(s.secret, { verifier, nonce, returnTo, cartId }), PENDING_TTL);
      const a = new URL(d.authorization_endpoint);
      const lang = (url.searchParams.get('locale') || '').replace(/[^a-zA-Z-]/g, '').slice(0, 8);
      const country = (url.searchParams.get('country') || '').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
      Object.entries({
        client_id: s.clientId, scope: 'openid email customer-account-api:full', response_type: 'code', redirect_uri: callbackUrl,
        state, nonce, code_challenge: b64url(await sha256(verifier)), code_challenge_method: 'S256',
        ...(lang ? { locale: lang } : {}), ...(country ? { region_country: country } : {}),
      }).forEach(([k, v]) => a.searchParams.set(k, v));
      return redirect(a.toString());
    }

    // ---- callback from Shopify
    if (route === '/callback' && request.method === 'GET') {
      const state = url.searchParams.get('state') || '';
      const pendingKey = `p:${hex(await sha256(state))}`;
      const pending = state ? await open(s.secret, await store.get(pendingKey)) : null;
      if (!pending) return redirect(`${siteOrigin}/?account=expired`);
      await store.delete(pendingKey); // one use
      if (url.searchParams.get('error') || !url.searchParams.get('code')) return redirect(safeReturn(pending.returnTo, s));
      const d = await discover(s, fetchImpl);
      const t = await tokenRequest(s, d, { grant_type: 'authorization_code', redirect_uri: callbackUrl, code: url.searchParams.get('code'), code_verifier: pending.verifier }, siteOrigin, fetchImpl);
      await verifyIdToken(t.id_token, d, s, pending.nonce, fetchImpl);
      const id = random(32);
      const session = { access: t.access_token, refresh: t.refresh_token || null, idToken: t.id_token, expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
      await saveSession(id, session);
      if (pending.cartId) await linkCart(s, pending.cartId, session.access, fetchImpl).catch(() => null);
      const back = new URL(safeReturn(pending.returnTo, s));
      back.searchParams.set('account', 'in');
      return redirect(back.href, { 'Set-Cookie': cookie(id, s.sessionDays * 86400) });
    }

    // ---- everything else is fetch() from the site: only allowed origins, credentials included
    if (!allow) return json({ error: 'origin not allowed' }, 403);
    const mutating = request.method === 'POST';
    if (mutating && request.headers.get('x-tether-account') !== '1') return json({ error: 'missing header' }, 400, allow); // CSRF: forces a CORS preflight

    let sess = await loadSession();
    if (sess) sess = await freshAccess(sess);

    if (route === '/me' && request.method === 'GET') {
      if (!sess) return json({ loggedIn: false }, 200, allow);
      const d = await discover(s, fetchImpl);
      const data = await customerQuery(s, d, sess.access, ME_QUERY, {}, siteOrigin, fetchImpl);
      const c = data.customer || {};
      return json({ loggedIn: true, customer: {
        firstName: c.firstName || null, lastName: c.lastName || null, displayName: c.displayName || null,
        email: c.emailAddress?.emailAddress || null, address: c.defaultAddress?.formatted || null,
      } }, 200, allow);
    }
    if (route === '/orders' && request.method === 'GET') {
      if (!sess) return json({ loggedIn: false, orders: [] }, 401, allow);
      const first = Math.max(1, Math.min(50, parseInt(url.searchParams.get('first') || '10', 10) || 10));
      const d = await discover(s, fetchImpl);
      const data = await customerQuery(s, d, sess.access, ORDER_QUERY, { first }, siteOrigin, fetchImpl);
      return json({ loggedIn: true, orders: data.customer?.orders?.nodes || [] }, 200, allow);
    }
    if (route === '/cart' && mutating) {
      if (!sess) return json({ loggedIn: false }, 401, allow);
      const body = await request.json().catch(() => ({}));
      if (!/^gid:\/\/shopify\/Cart\/[\w-]+(\?key=[\w-]+)?$/.test(body.cartId || '')) return json({ error: 'cartId' }, 400, allow);
      const checkoutUrl = await linkCart(s, body.cartId, sess.access, fetchImpl);
      return json({ linked: Boolean(checkoutUrl), checkoutUrl }, 200, allow);
    }
    if (route === '/logout' && mutating) {
      const clear = { ...allow, 'Set-Cookie': cookie('', 0) };
      if (!sess) return json({ logoutUrl: null }, 200, clear);
      await store.delete(await sessionKey(sid));
      const d = await discover(s, fetchImpl);
      const body = await request.json().catch(() => ({}));
      const u = new URL(d.end_session_endpoint);
      u.searchParams.set('id_token_hint', sess.idToken);
      u.searchParams.set('post_logout_redirect_uri', safeReturn(body.returnTo || `${siteOrigin}/`, s));
      if (body.cartId && /^gid:\/\/shopify\/Cart\//.test(body.cartId)) await linkCart(s, body.cartId, null, fetchImpl).catch(() => null);
      return json({ logoutUrl: u.toString() }, 200, clear);
    }
    return json({ error: 'not found' }, 404, allow);
  } catch (err) {
    console.error('account', err?.message);
    return json({ error: 'account error' }, 502, allow || {});
  }
}
