/**
 * Customer accounts (Shopify Customer Account API), as an optional part: loaded only when
 * config.account is set and the page uses it (or a login is in progress / the visitor is logged in).
 *
 *   window.TETHER_CONFIG = { …, account: { clientId: '…' } }   // Headless channel → Customer Account API
 *
 *   <button tether-account-login>Log in</button>
 *   <button tether-account-logout tether-show="logged-in">Log out</button>
 *   <span tether-account-bind="first-name"></span>             first-name, last-name, name, email
 *   <div tether-orders>                                       the customer's orders (first child = template)
 *     <a tether-order-bind="url"><span tether-order-bind="name"></span> · <span tether-order-bind="date"></span> ·
 *       <span tether-order-bind="total"></span> · <span tether-order-bind="status"></span></a>
 *   </div>
 *   <p tether-show="logged-out">…</p>
 *
 * Everything runs between the visitor's browser and Shopify: login on Shopify's own page (OAuth with
 * PKCE), tokens kept in this browser (window.sessionStorage; account.remember: true for window.localStorage), the
 * cart linked to the customer so checkout knows them. No other server sees the customer's data.
 * Shopify needs HTTPS (no localhost: use a tunnel) and the site's origin, callback and logout URLs
 * registered in the Headless channel's Customer Account API settings (client type: Public).
 */
import { cfg, log, reportError } from './config.js';
import { TetherError } from './client.js';
import { attr, sel, get, qsa, setText, setImage, repeat, show, formatMoney, emit } from './dom.js';
import { Cart } from './cart.js';
import { loadPart } from './lazy.js';

const KEY = () => `${cfg.prefix}:account:${cfg.domain}`;
const PENDING = () => `${cfg.prefix}:account-login:${cfg.domain}`;
const store = () => (cfg.account?.remember ? window.localStorage : window.sessionStorage);
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (s) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const go = (url) => (cfg.account?.navigate || ((u) => window.location.assign(u)))(url); // overridable (popup, tests)
const read = (s, k) => { try { return JSON.parse(s.getItem(k) || 'null'); } catch { return null; } };
const write = (s, k, v) => { try { if (v) s.setItem(k, JSON.stringify(v)); else s.removeItem(k); } catch { /* private mode */ } };

let discovery = null;
let session = null; // { access, expiresAt, refresh, idToken }
let refreshing = null;
let customerCache = null;

// Server mode (account.server): the Worker holds the tokens, this browser only a session cookie it
// can't read. Recommended for live sites.
// A full URL or a path on this site ('/_tether/account').
const server = () => (cfg.account?.server ? new URL(String(cfg.account.server), window.location.href).href.replace(/\/$/, '') : '');
const HINT = () => `${cfg.prefix}:account-hint:${cfg.domain}`; // "may be logged in": loads this part, no secret
let serverState = null; // { loggedIn, customer }
async function serverFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${server()}${path}`, {
    method, credentials: 'include',
    headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-Tether-Account': '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 401) throw new TetherError(`Customer accounts: ${data.error || res.status}`, { status: res.status, userErrors: data.userErrors });
  return data;
}
async function serverMe() {
  serverState ||= await serverFetch('/me');
  try { if (serverState.loggedIn) window.localStorage.setItem(HINT(), '1'); else window.localStorage.removeItem(HINT()); } catch { /* private mode */ }
  return serverState;
}

/** Shopify's endpoints for this shop (they differ for shops with their own accounts domain). */
async function discover() {
  if (discovery) return discovery;
  const shop = cfg.account?.shopDomain || cfg.domain;
  const get = (p) => fetch(`https://${shop}/.well-known/${p}`).then((r) => {
    if (!r.ok) throw new TetherError(`Customer accounts: ${p} answered ${r.status}`, { status: r.status });
    return r.json();
  });
  const [oidc, api] = await Promise.all([get('openid-configuration'), get('customer-account-api')]);
  discovery = { ...oidc, graphql: api.graphql_api };
  return discovery;
}

const callbackUrl = () => cfg.account?.callbackUrl || `${window.location.origin}${window.location.pathname}`;

export function isLoggedIn() { return server() ? Boolean(serverState?.loggedIn) : Boolean(session?.refresh || (session?.access && session.expiresAt > Date.now())); }

/** Redirects to Shopify's login page; the visitor comes back to account.callbackUrl (default: this page). */
export async function login({ returnTo = window.location.href, locale } = {}) {
  if (server()) {
    const u = new URL(`${server()}/login`);
    u.searchParams.set('returnTo', returnTo); // the cart is linked later, through the Worker's protected POST /cart
    const lang = locale || cfg.account.locale || (cfg.locale || '').split('-')[0];
    if (lang) u.searchParams.set('locale', lang);
    if (cfg.country) u.searchParams.set('country', String(cfg.country).toUpperCase());
    go(u.toString());
    return;
  }
  if (!cfg.account?.clientId) throw new TetherError('Customer accounts: set account.clientId', { code: 'NOT_CONFIGURED' });
  const d = await discover();
  const state = random();
  const nonce = random();
  const verifier = random();
  const redirect = callbackUrl();
  write(window.sessionStorage, PENDING(), { state, nonce, verifier, redirect, returnTo, at: Date.now() });
  const u = new URL(d.authorization_endpoint);
  const p = {
    client_id: cfg.account.clientId, scope: 'openid email customer-account-api:full', response_type: 'code',
    redirect_uri: redirect, state, nonce, code_challenge: await sha256(verifier), code_challenge_method: 'S256',
  };
  const lang = locale || cfg.account.locale || (cfg.locale || '').split('-')[0];
  if (lang) p.locale = lang;
  if (cfg.country) p.region_country = String(cfg.country).toUpperCase();
  Object.entries(p).forEach(([k, v]) => u.searchParams.set(k, v));
  go(u.toString());
}

/** Token endpoint: from the browser (a "simple" request), or account.tokenUrl on your own server. */
async function tokenRequest(params) {
  const d = await discover();
  const res = await fetch(cfg.account.tokenUrl || d.token_endpoint, { method: 'POST', body: new URLSearchParams(params) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new TetherError(`Customer accounts: token ${res.status} ${data.error || ''}`.trim(), { status: res.status, code: res.status === 400 || res.status === 401 ? 'SESSION_ENDED' : 'TOKEN_FAILED' });
  return data;
}

function decodeJwt(t) {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

function keep(data, previous = session) {
  session = {
    access: data.access_token,
    expiresAt: Date.now() + Math.max(0, (Number(data.expires_in) || 3600) - 120) * 1000,
    refresh: data.refresh_token || previous?.refresh,
    idToken: data.id_token || previous?.idToken,
  };
  write(store(), KEY(), session);
}

/** On the callback page: ?code=&state= from Shopify. Returns true when a login finished. */
export async function handleCallback() {
  const q = new URLSearchParams(window.location.search);
  const pending = read(window.sessionStorage, PENDING());
  if (!pending || (!q.has('code') && !q.has('error')) || q.get('state') !== pending.state) return false;
  write(window.sessionStorage, PENDING(), null);
  const clean = new URL(window.location.href);
  ['code', 'state', 'iss', 'error', 'error_description'].forEach((k) => clean.searchParams.delete(k));
  window.history.replaceState(window.history.state, '', clean);
  if (q.has('error')) { emit('account-error', { error: q.get('error') }); return false; }
  if (Date.now() - pending.at > 10 * 60000) throw new TetherError('Customer accounts: the login took too long, please try again');
  const data = await tokenRequest({
    grant_type: 'authorization_code', client_id: cfg.account.clientId, redirect_uri: pending.redirect,
    code: q.get('code'), code_verifier: pending.verifier,
  });
  const d = await discover();
  const claims = decodeJwt(data.id_token || '');
  const aud = [].concat(claims?.aud || []);
  if (!claims || claims.nonce !== pending.nonce || claims.iss !== d.issuer || !aud.includes(cfg.account.clientId) || claims.exp * 1000 < Date.now()) {
    throw new TetherError('Customer accounts: the login answer did not check out (nonce/issuer/audience)');
  }
  keep(data, null);
  await linkCart();
  emit('account-login', {});
  const back = pending.returnTo && new URL(pending.returnTo, window.location.href);
  if (back && back.origin === window.location.origin && back.href !== clean.href) go(back.href);
  return true;
}

/** A valid access token (refreshed when needed, one refresh at a time), or null when logged out. */
export async function getToken() {
  if (server()) return null; // server mode: tokens never come to the browser
  if (!session) session = read(store(), KEY());
  if (!session) return null;
  if (session.access && session.expiresAt > Date.now()) return session.access;
  if (!session.refresh) { endSession(); return null; }
  refreshing ||= (async () => {
    try {
      keep(await tokenRequest({ grant_type: 'refresh_token', client_id: cfg.account.clientId, refresh_token: session.refresh }));
      await linkCart();
    } catch (err) {
      if (err.code === 'SESSION_ENDED') endSession(); else throw err;
    } finally { refreshing = null; }
  })();
  await refreshing;
  return session?.access || null;
}

function endSession() {
  session = null;
  customerCache = null;
  write(store(), KEY(), null);
  Cart.customerAccessToken = null;
}

/** The customer's checkout is theirs: saved addresses, vaulted cards, order window.history. */
async function linkCart() {
  Cart.customerAccessToken = session?.access || null;
  if (Cart.id() && session?.access) {
    await Cart.setBuyerIdentity({ customerAccessToken: session.access }, { create: false }).catch((err) => reportError(err, 'account cart'));
  }
}

/** Any Customer Account API query. */
export async function query(q, variables = {}) {
  if (server()) throw new TetherError('Customer accounts in server mode only answer customer() and orders()', { code: 'NOT_ALLOWED' });
  const token = await getToken();
  if (!token) throw new TetherError('Not logged in', { code: 'NOT_LOGGED_IN' });
  const d = await discover();
  const run = (t) => fetch(d.graphql, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: t }, body: JSON.stringify({ query: q, variables }) });
  let res = await run(token);
  if (res.status === 401 && session?.refresh) { session.expiresAt = 0; res = await run(await getToken()); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) throw new TetherError(json.errors?.map((e) => e.message).join(' | ') || `Customer accounts: ${res.status}`, { status: res.status });
  return json.data;
}

export async function customer() {
  if (server()) {
    const me = await serverMe();
    return me.loggedIn ? { ...me.customer, emailAddress: { emailAddress: me.customer.email }, defaultAddress: { formatted: me.customer.address } } : null;
  }
  if (customerCache) return customerCache;
  const data = await query(`query TetherCustomer { customer { id firstName lastName displayName emailAddress { emailAddress } defaultAddress { formatted } } }`);
  customerCache = data.customer;
  return customerCache;
}

export async function orders({ first = 10 } = {}) {
  if (server()) return (await serverFetch(`/orders?first=${first}`)).orders || [];
  const data = await query(`query TetherOrders($first: Int!) { customer { orders(first: $first, sortKey: PROCESSED_AT, reverse: true) {
    nodes { id name processedAt financialStatus fulfillmentStatus statusPageUrl totalPrice { amount currencyCode }
      lineItems(first: 20) { nodes { title variantTitle quantity image { url altText } } } } } } }`, { first });
  return data.customer?.orders?.nodes || [];
}


/** Logs out here and at Shopify, unlinks the cart. */
export async function logout({ returnTo = cfg.account?.logoutUrl || `${window.location.origin}/` } = {}) {
  if (server()) {
    const r = await serverFetch('/logout', { method: 'POST', body: { returnTo, cartId: Cart.id() } });
    serverState = { loggedIn: false };
    try { window.localStorage.removeItem(HINT()); } catch { /* private mode */ }
    emit('account-logout', {});
    if (r.logoutUrl) go(r.logoutUrl); else render(document);
    return;
  }
  const idToken = session?.idToken || read(store(), KEY())?.idToken;
  if (Cart.id()) await Cart.setBuyerIdentity({ customerAccessToken: null }, { create: false }).catch(() => {});
  endSession();
  emit('account-logout', {});
  if (!idToken) { render(document); return; }
  const d = await discover();
  const u = new URL(d.end_session_endpoint);
  u.searchParams.set('id_token_hint', idToken);
  u.searchParams.set('post_logout_redirect_uri', returnTo);
  go(u.toString());
}

// ---------------------------------------------------------------- markup

const https = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } }; // links from Shopify: https only
const date = (s) => { try { return new Date(s).toLocaleDateString(cfg.locale || undefined); } catch { return s; } };

export async function render(root = document) {
  const logged = server() ? Boolean((await serverMe().catch(() => ({ loggedIn: false }))).loggedIn) : isLoggedIn() || Boolean(await getToken().catch(() => null));
  qsa(root, sel('show')).forEach((el) => {
    const k = get(el, 'show');
    if (k === 'logged-in') show(el, logged);
    if (k === 'logged-out') show(el, !logged);
  });
  // Shopify's own pages, for what has to stay there: tether-account-link="subscriptions" / "payment"
  // (account.subscriptionsUrl / paymentUrl), or the account itself.
  qsa(root, sel('account-link')).forEach((a) => {
    const k = get(a, 'account-link');
    const u = (k === 'payment' && (cfg.account?.paymentUrl || cfg.account?.subscriptionsUrl)) || (k === 'subscriptions' && cfg.account?.subscriptionsUrl);
    a.setAttribute('href', u || `https://${cfg.domain}/account`);
  });
  if (!logged) return;
  const binds = qsa(root, sel('account-bind'));
  if (binds.length) {
    const c = await customer().catch((err) => { reportError(err, 'account'); return null; });
    binds.forEach((el) => {
      const v = { 'first-name': c?.firstName, 'last-name': c?.lastName, name: c?.displayName, email: c?.emailAddress?.emailAddress, address: c?.defaultAddress?.formatted?.join(', ') }[get(el, 'account-bind')];
      if (v != null) setText(el, v);
    });
  }
  const lists = qsa(root, sel('orders'));
  if (lists.length) {
    // tether-show="orders-loading" / "orders-empty" (no orders yet).
    const ordersShow = (loading, empty) => qsa(root, sel('show')).forEach((el) => {
      const k = get(el, 'show');
      if (k === 'orders-loading') show(el, loading);
      if (k === 'orders-empty') show(el, empty);
    });
    ordersShow(true, false);
    let failed = false;
    const list = await orders({ first: parseInt(get(lists[0], 'limit') || '10', 10) }).catch((err) => { reportError(err, 'orders'); failed = true; return []; });
    ordersShow(false, !failed && list.length === 0);
    lists.forEach((c) => repeat(c, list, (node, o) => {
      const items = o.lineItems?.nodes || [];
      qsa(node, sel('order-bind')).forEach((el) => {
        const k = get(el, 'order-bind');
        if (k === 'url') { const u = orderUrl(o); if (u) el.setAttribute('href', u); return; }
        if (k === 'image') { const im = items.find((l) => l.image)?.image; if (im) setImage(el, im.url, im.altText || items[0]?.title || ''); return; }
        const v = { name: o.name, date: date(o.processedAt), total: formatMoney(o.totalPrice), status: o.financialStatus?.toLowerCase(), fulfillment: o.fulfillmentStatus?.toLowerCase(), items: items.map((l) => `${l.quantity}× ${l.title}`).join(', ') }[k];
        if (v != null) setText(el, v);
      });
      // Per product of the order: <div tether-order-lines><div><img tether-order-line="image"> <span tether-order-line="title"></span></div></div>
      qsa(node, sel('order-lines')).forEach((box) => fillLines(box, items));
      if (get(node, 'order-bind') === 'url' && orderUrl(o)) node.setAttribute('href', orderUrl(o));
    }));
  }
  if (PAGE_ATTRS.some((n) => qsa(root, sel(n)).length)) await (await pages()).renderPages(root);
}


const nid = (g) => String(g || '').split('/').pop().split('?')[0];
/** The order's page: your own (account.orderUrl: '/account/order?id={id}') or Shopify's status page. */
function orderUrl(o) {
  const t = cfg.account?.orderUrl;
  if (t) return String(t).replace('{id}', encodeURIComponent(nid(o.id)));
  return https(o.statusPageUrl) ? o.statusPageUrl : null;
}
function fillLines(box, items) {
  repeat(box, items, (row, l) => {
    qsa(row, sel('order-line')).concat(row.matches(sel('order-line')) ? [row] : []).forEach((el) => {
      const k = get(el, 'order-line');
      if (k === 'image') { if (l.image) setImage(el, l.image.url, l.image.altText || l.title); return; }
      const v = { title: l.title, 'variant-title': l.variantTitle || '', quantity: String(l.quantity) }[k];
      if (v != null) setText(el, v);
    });
  });
}

// Order page, profile, addresses, subscriptions, returns: their own part (account-pages), loaded
// only on pages that use them. It gets this module's login state, so both share one session.
const PAGE_ATTRS = ['order', 'addresses', 'subscriptions', 'profile-form', 'address-form'];
let pagesPart = null;
function pages() {
  pagesPart ||= loadPart('account-pages').then((m) => { m.setup({ server, serverFetch, query, customer, reset: () => { customerCache = null; serverState = null; } }); return m; });
  return pagesPart;
}
const viaPages = (name) => (...a) => pages().then((m) => m[name](...a));
/** One of the customer's orders, in full (lines, totals, addresses, fulfillments, returns). */
export const order = viaPages('order');
export const updateProfile = viaPages('updateProfile');
export const addresses = viaPages('addresses');
/** saveAddress({ address1, city, zip, countryCode, … }, { id, isDefault }): creates, or updates with an id. */
export const saveAddress = viaPages('saveAddress');
export const deleteAddress = viaPages('deleteAddress');
export const subscriptions = viaPages('subscriptions');
/** subscriptionAction(id, 'pause' | 'resume' | 'skip' | 'unskip' | 'cancel') */
export const subscriptionAction = viaPages('subscriptionAction');
/** requestReturn(orderId, [{ lineItemId, quantity, reasonId, note }]) */
export const requestReturn = viaPages('requestReturn');

let bound = false;
/** Called by the core on mount: finish a login that's coming back, then fill the page. */
export async function mountAccount(root = document) {
  if (!bound) {
    bound = true;
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest?.(sel('account-login'))) { e.preventDefault(); login().catch((err) => reportError(err, 'login')); }
      else if (t.closest?.(sel('account-logout'))) { e.preventDefault(); logout().catch((err) => reportError(err, 'logout')); }
    });
    if (server()) {
      // Back from the Worker's login: drop ?account=in; at checkout the Worker links the cart.
      const u = new URL(window.location.href);
      if (u.searchParams.get('account')) { u.searchParams.delete('account'); window.history.replaceState(window.history.state, '', u); emit('account-login', {}); }
      Cart.beforeCheckout = async () => {
        if (!(await serverMe()).loggedIn || !Cart.id()) return null;
        const r = await serverFetch('/cart', { method: 'POST', body: { cartId: Cart.id() } }).catch(() => null);
        return r?.checkoutUrl ? `${r.checkoutUrl}${r.checkoutUrl.includes('?') ? '&' : '?'}logged_in=true` : null;
      };
    } else {
      try { await handleCallback(); } catch (err) { reportError(err, 'login'); }
      if (!Cart.customerAccessToken && (await getToken().catch(() => null))) Cart.customerAccessToken = session.access;
    }
    log('account', isLoggedIn() ? 'logged in' : 'logged out');
  }
  await render(root);
}
