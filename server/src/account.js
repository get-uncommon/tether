/**
 * Customer accounts through the Worker (the safe mode): the visitor's browser never holds a Shopify
 * token. The Worker logs the customer in with Shopify's Customer Account API (OAuth + PKCE, the
 * id token's signature checked against Shopify's keys), keeps the tokens encrypted in KV, and gives
 * the browser only a session cookie that scripts can't read (__Host-, HttpOnly, Secure, SameSite=Lax).
 * The browser can ask for a fixed set of things: the profile, the orders, linking its cart, logout.
 *
 * Routes (the Worker must run on the shop's own domain, e.g. a route shop.com/_tether/*):
 *   GET  /_tether/account/login?returnTo=        to Shopify's login page (pending login sealed in a cookie)
 *   GET  /_tether/account/callback               back from Shopify: session cookie, then returnTo
 *   GET  /_tether/account/me                     { loggedIn, customer }
 *   GET  /_tether/account/orders?first=10        { orders }
 *   POST /_tether/account/cart   { cartId }      links the cart to the customer, { checkoutUrl }
 *   POST /_tether/account/logout                 ends the session (always), { logoutUrl }
 *   GET  /_tether/account/logout/go              on to Shopify's logout (id token from a one-time cookie)
 *
 * Settings (Worker secrets): ACCOUNT_CLIENT_ID (Headless channel → Customer Account API),
 * ACCOUNT_CLIENT_SECRET (only for a Confidential client), ACCOUNT_ORIGINS (the site, e.g.
 * https://shop.com, comma-separated), STOREFRONT_TOKEN (the public token, to link carts),
 * SHOPIFY_DOMAIN and SYNC_SECRET (already set; the encryption keys are derived from it, or from
 * ACCOUNT_SECRET if you set one).
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
    secret: val(env.ACCOUNT_SECRET) || val(env.SYNC_SECRET), // ACCOUNT_SECRET: a key only for sessions (optional)
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
  if (s.secret.length < 24) p.push('SYNC_SECRET or ACCOUNT_SECRET (24+ characters) is needed: the session encryption key comes from it');
  if (!s.storefrontToken) p.push('STOREFRONT_TOKEN (the public Storefront token) is missing: carts can\'t be linked, so checkout won\'t know the customer');
  return p;
}

// ---------------------------------------------------------------- crypto

const keys = new Map();
/** One AES-GCM key per purpose ('session', 'login', 'logout'), derived with HKDF. */
async function aesKey(secret, purpose) {
  const id = `${purpose}:${secret}`;
  if (!keys.has(id)) {
    const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
    keys.set(id, await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('tether-account-v1'), info: enc.encode(purpose) },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    ));
  }
  return keys.get(id);
}
/** Encrypt for one purpose, bound to `bind` (the KV key or cookie name): it can't be moved elsewhere. */
async function seal(secret, purpose, bind, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(bind) }, await aesKey(secret, purpose), enc.encode(JSON.stringify(data)));
  return `${b64url(iv)}.${b64url(ct)}`;
}
async function open(secret, purpose, bind, sealed) {
  if (!sealed) return null;
  try {
    const [iv, ct] = String(sealed).split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv), additionalData: enc.encode(bind) }, await aesKey(secret, purpose), fromB64url(ct));
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
const JSON_HEADERS = { Accept: 'application/json', 'User-Agent': 'tether-sync (Cloudflare Worker)' };
/** The shop's numeric id, from the Storefront API (gid://shopify/Shop/123 -> 123). */
async function shopId(s, fetchImpl) {
  if (!s.storefrontToken) return null;
  const r = await fetchImpl(`https://${s.shopDomain}/api/${s.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': s.storefrontToken },
    body: JSON.stringify({ query: '{ shop { id } }' }),
  });
  const id = r.ok ? (await r.json())?.data?.shop?.id : null;
  return id ? String(id).split('/').pop() : null;
}
async function discover(s, fetchImpl) {
  const hit = discoveryCache.get(s.shopDomain);
  if (hit && hit.until > Date.now()) return hit.value;
  const get = async (url) => {
    const r = await fetchImpl(url, { headers: JSON_HEADERS });
    if (!r.ok) throw new Error(`${url.replace(/^https:\/\/[^/]+/, '')} answered ${r.status}`);
    return r.json();
  };
  const [oidc, api] = await Promise.allSettled([
    get(`https://${s.shopDomain}/.well-known/openid-configuration`),
    get(`https://${s.shopDomain}/.well-known/customer-account-api`),
  ]);
  let value;
  if (oidc.status === 'fulfilled' && api.status === 'fulfilled') {
    value = { ...oidc.value, graphql: api.value.graphql_api };
  } else {
    // The store domain's bot protection can refuse requests from Workers (403). Shopify's
    // account host and the Storefront API don't: find the shop id and use the same addresses.
    const id = await shopId(s, fetchImpl).catch(() => null);
    if (!id) throw (oidc.reason || api.reason);
    const auth = `https://shopify.com/authentication/${id}`;
    const conf = oidc.status === 'fulfilled' ? oidc.value : await get(`${auth}/.well-known/openid-configuration`).catch(() => ({
      issuer: auth, authorization_endpoint: `${auth}/oauth/authorize`, token_endpoint: `${auth}/oauth/token`,
      end_session_endpoint: `${auth}/logout`, jwks_uri: `${auth}/.well-known/jwks.json`,
    }));
    value = { ...conf, graphql: api.status === 'fulfilled' ? api.value.graphql_api : `https://shopify.com/${id}/account/customer/api/${s.apiVersion}/graphql` };
  }
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

const LOGIN_COOKIE = '__Host-tether-login';   // the pending login, sealed, in the browser that started it
const LOGOUT_COOKIE = '__Host-tether-logout'; // one-time: the id token for Shopify's logout, never readable by scripts
const readCookie = (req, name = COOKIE, max = 100) => {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_.-]{20,${max}})`));
  return m ? m[1] : null;
};
const cookie = (value, maxAge, name = COOKIE) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const CART_ID = /^gid:\/\/shopify\/Cart\/[\w-]+(\?key=[\w-]+)?$/;
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
  if (!s) return json({ error: 'accounts are not set up' }, 404);
  const problems = accountProblems(s).filter((p) => !/STOREFRONT_TOKEN/.test(p));
  if (problems.length) { console.error('account setup', problems.join('; ')); return json({ error: 'accounts are not set up (see /check)' }, 503); }
  const store = kv(env, memory);
  const route = url.pathname.slice(BASE.length);
  const callbackUrl = `${url.origin}${BASE}/callback`;
  const allow = cors(request, s);
  const siteOrigin = s.origins[0];
  const maxAge = s.sessionDays * 86400;

  if (request.method === 'OPTIONS') return allow ? new Response(null, { status: 204, headers: { ...allow, ...SAFE } }) : new Response(null, { status: 403 });

  // ---- sessions: KV under a hash of the session id, encrypted and bound to that key
  const sid = readCookie(request);
  const sessionKey = async (id) => `s:${hex(await sha256(id))}`;
  const loadSession = async () => {
    if (!sid) return null;
    const key = await sessionKey(sid);
    const sess = await open(s.secret, 'session', key, await store.get(key));
    if (sess && Date.now() - sess.createdAt > maxAge * 1000) { await store.delete(key); return null; } // absolute lifetime
    return sess;
  };
  const saveSession = async (id, data) => {
    const key = await sessionKey(id);
    const left = Math.ceil((data.createdAt + maxAge * 1000 - Date.now()) / 1000); // no sliding past the lifetime
    await store.put(key, await seal(s.secret, 'session', key, data), left);
  };
  const endSession = async () => { if (sid) await store.delete(await sessionKey(sid)); };
  const freshAccess = async (sess) => {
    if (sess.expiresAt > Date.now() + 5 * 60e3) return sess; // refresh well before expiry: fewer parallel refreshes
    const d = await discover(s, fetchImpl);
    try {
      const t = await tokenRequest(s, d, { grant_type: 'refresh_token', refresh_token: sess.refresh }, siteOrigin, fetchImpl);
      const next = { ...sess, access: t.access_token, refresh: t.refresh_token || sess.refresh, idToken: t.id_token || sess.idToken, expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
      await saveSession(sid, next);
      return next;
    } catch (err) {
      if (!err.ended) throw err;
      // Another request may be refreshing at the same moment (Shopify rotates the refresh token):
      // give it a moment and use its result. Only a refusal nobody recovered from ends the session.
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const now = await loadSession();
        if (now && now.refresh !== sess.refresh) return now;
        if (!now) return null;
      }
      await endSession();
      return null;
    }
  };

  try {
    // ---- login: a top-level navigation from the site. Nothing is stored before the customer
    // comes back: the pending login is sealed into a cookie in this browser (login CSRF, KV quota).
    if (route === '/login' && request.method === 'GET') {
      const d = await discover(s, fetchImpl);
      const pending = {
        state: random(), nonce: random(), verifier: random(), at: Date.now(),
        returnTo: safeReturn(url.searchParams.get('returnTo') || request.headers.get('referer') || '', s),
      };
      const a = new URL(d.authorization_endpoint);
      const lang = (url.searchParams.get('locale') || '').replace(/[^a-zA-Z-]/g, '').slice(0, 8);
      const country = (url.searchParams.get('country') || '').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
      Object.entries({
        client_id: s.clientId, scope: 'openid email customer-account-api:full', response_type: 'code', redirect_uri: callbackUrl,
        state: pending.state, nonce: pending.nonce, code_challenge: b64url(await sha256(pending.verifier)), code_challenge_method: 'S256',
        ...(lang ? { locale: lang } : {}), ...(country ? { region_country: country } : {}),
      }).forEach(([k, v]) => a.searchParams.set(k, v));
      return redirect(a.toString(), { 'Set-Cookie': cookie(await seal(s.secret, 'login', LOGIN_COOKIE, pending), PENDING_TTL, LOGIN_COOKIE) });
    }

    // ---- callback from Shopify: only in the browser that started this login
    if (route === '/callback' && request.method === 'GET') {
      const clearLogin = cookie('', 0, LOGIN_COOKIE);
      const pending = await open(s.secret, 'login', LOGIN_COOKIE, readCookie(request, LOGIN_COOKIE, 2000));
      const state = url.searchParams.get('state') || '';
      if (!pending || !state || pending.state !== state || Date.now() - pending.at > PENDING_TTL * 1000) {
        return redirect(`${siteOrigin}/?account=expired`, { 'Set-Cookie': clearLogin });
      }
      if (url.searchParams.get('error') || !url.searchParams.get('code')) return redirect(safeReturn(pending.returnTo, s), { 'Set-Cookie': clearLogin });
      const d = await discover(s, fetchImpl);
      const t = await tokenRequest(s, d, { grant_type: 'authorization_code', redirect_uri: callbackUrl, code: url.searchParams.get('code'), code_verifier: pending.verifier }, siteOrigin, fetchImpl);
      await verifyIdToken(t.id_token, d, s, pending.nonce, fetchImpl);
      const id = random(32);
      await saveSession(id, { access: t.access_token, refresh: t.refresh_token || null, idToken: t.id_token, createdAt: Date.now(), expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000 });
      const back = new URL(safeReturn(pending.returnTo, s));
      back.searchParams.set('account', 'in');
      const headers = new Headers({ Location: back.href, ...SAFE });
      headers.append('Set-Cookie', cookie(id, maxAge));
      headers.append('Set-Cookie', clearLogin);
      return new Response(null, { status: 302, headers });
    }

    // ---- logout, step 2: a top-level navigation; the id token comes from a one-time HttpOnly cookie
    if (route === '/logout/go' && request.method === 'GET') {
      const ticket = await open(s.secret, 'logout', LOGOUT_COOKIE, readCookie(request, LOGOUT_COOKIE, 6000));
      const clear = cookie('', 0, LOGOUT_COOKIE);
      if (!ticket || Date.now() - ticket.at > 120e3) return redirect(`${siteOrigin}/`, { 'Set-Cookie': clear });
      try {
        const d = await discover(s, fetchImpl);
        const u = new URL(d.end_session_endpoint);
        u.searchParams.set('id_token_hint', ticket.idToken);
        u.searchParams.set('post_logout_redirect_uri', ticket.returnTo);
        return redirect(u.toString(), { 'Set-Cookie': clear });
      } catch { return redirect(ticket.returnTo, { 'Set-Cookie': clear }); }
    }

    // ---- everything else is fetch() from the site: only allowed origins, credentials included
    if (!allow) return json({ error: 'origin not allowed' }, 403);
    const mutating = request.method === 'POST';
    if (mutating && request.headers.get('x-tether-account') !== '1') return json({ error: 'missing header' }, 400, allow); // CSRF: forces a CORS preflight

    // ---- logout, step 1: ends the session here first, whatever Shopify does (never fails open)
    if (route === '/logout' && mutating) {
      const body = await request.json().catch(() => ({}));
      const sess = await loadSession().catch(() => null);
      await endSession().catch((err) => console.error('account logout', err?.message));
      const headers = new Headers({ 'Content-Type': 'application/json', ...SAFE, ...allow });
      headers.append('Set-Cookie', cookie('', 0));
      const returnTo = safeReturn(body.returnTo || `${siteOrigin}/`, s);
      if (CART_ID.test(body.cartId || '')) await linkCart(s, body.cartId, null, fetchImpl).catch(() => null); // unlink, also without a session
      let logoutUrl = null;
      if (sess?.idToken) {
        headers.append('Set-Cookie', cookie(await seal(s.secret, 'logout', LOGOUT_COOKIE, { idToken: sess.idToken, returnTo, at: Date.now() }), 120, LOGOUT_COOKIE));
        logoutUrl = `${url.origin}${BASE}/logout/go`;
      }
      return new Response(JSON.stringify({ loggedOut: true, logoutUrl }), { status: 200, headers });
    }

    let sess = await loadSession();
    if (sess) sess = await freshAccess(sess);
    const ask = async (q, v) => {
      try { return await customerQuery(s, await discover(s, fetchImpl), sess.access, q, v, siteOrigin, fetchImpl); } catch (err) {
        if (err.status === 401) { await endSession(); sess = null; return null; } // Shopify ended it
        throw err;
      }
    };

    if (route === '/me' && request.method === 'GET') {
      const data = sess && await ask(ME_QUERY, {});
      if (!data) return json({ loggedIn: false }, 200, allow);
      const c = data.customer || {};
      return json({ loggedIn: true, customer: {
        firstName: c.firstName || null, lastName: c.lastName || null, displayName: c.displayName || null,
        email: c.emailAddress?.emailAddress || null, address: c.defaultAddress?.formatted || null,
      } }, 200, allow);
    }
    if (route === '/orders' && request.method === 'GET') {
      const first = Math.max(1, Math.min(50, parseInt(url.searchParams.get('first') || '10', 10) || 10));
      const data = sess && await ask(ORDER_QUERY, { first });
      if (!data) return json({ loggedIn: false, orders: [] }, 401, allow);
      return json({ loggedIn: true, orders: data.customer?.orders?.nodes || [] }, 200, allow);
    }
    if (route === '/cart' && mutating) {
      if (!sess) return json({ loggedIn: false }, 401, allow);
      const body = await request.json().catch(() => ({}));
      if (!CART_ID.test(body.cartId || '')) return json({ error: 'cartId' }, 400, allow);
      const checkoutUrl = await linkCart(s, body.cartId, sess.access, fetchImpl);
      return json({ linked: Boolean(checkoutUrl), checkoutUrl }, 200, allow);
    }
    return json({ error: 'not found' }, 404, allow);
  } catch (err) {
    console.error('account', err?.message);
    return json({ error: 'account error' }, 502, allow || {});
  }
}
