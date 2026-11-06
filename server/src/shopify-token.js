/**
 * The Shopify Admin API access token: a static admin token, or one from the client credentials grant, cached in
 * memory and, sealed, in the store between runs.
 */
import { SyncError } from './util.js';
import { open, seal } from './crypto.js';
import { asRecord, responseJsonOrNull } from './json.js';

/** @typedef {import('./store.js').Store} Store */
/** @typedef {typeof fetch} Fetch */

// The client-credentials token is cached sealed with the client secret, which only Worker secrets hold: KV values
// can be read in Cloudflare's dashboard, secrets can't.
const TOKEN_KEY = 'shopify:token';
const TOKEN_PURPOSE = 'shopify-token';
/** A token this close to its expiry is fetched again rather than used. */
const TOKEN_MARGIN_MS = 60_000;
/** Shopify's client-credentials tokens last a day; used when the answer leaves `expires_in` out. */
const DEFAULT_TOKEN_SECONDS = 86_399;

/** @typedef {{ token: string, expires: number }} AccessToken `expires` is a `Date.now()` time. */

/**
 * @typedef {{ kind: 'admin-token', token: string }
 *   | { kind: 'client-credentials', clientId: string, clientSecret: string }} ShopifyAuth
 */

/**
 * Where the access token comes from. `replace` is `null` for a static admin token, which a 401 cannot fix.
 *
 * @typedef {object} TokenSource
 * @property {() => Promise<string>} current
 * @property {(() => Promise<string>) | null} replace
 */

/** @typedef {{ shop: string, fetchImpl: Fetch, now: () => number, tokenStore: Store | null }} TokenContext */

/**
 * @param {{ adminToken?: string | undefined, clientId?: string | undefined, clientSecret?: string | undefined }} settings
 * @returns {ShopifyAuth}
 */
function authFrom({ adminToken, clientId, clientSecret }) {
  if (adminToken) return { kind: 'admin-token', token: adminToken };
  if (clientId && clientSecret) return { kind: 'client-credentials', clientId, clientSecret };
  throw new SyncError('Shopify auth missing: set SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET');
}

/**
 * @param {unknown} json The token endpoint's answer.
 * @param {number} now
 * @returns {AccessToken}
 */
function parseAccessToken(json, now) {
  const { access_token: token, expires_in: seconds } = asRecord(json);
  if (typeof token !== 'string' || !token) throw new SyncError('Shopify token response has no access_token');
  const lifetime = typeof seconds === 'number' && seconds > 0 ? seconds : DEFAULT_TOKEN_SECONDS;
  return { token, expires: now + lifetime * 1000 };
}

/**
 * A token cached by an earlier run, or `null` when the stored value is missing, unreadable or of another shape.
 *
 * @param {unknown} saved What `open` returned.
 * @returns {AccessToken | null}
 */
function parseCachedToken(saved) {
  const { token, expires } = asRecord(saved);
  return typeof token === 'string' && token && typeof expires === 'number' ? { token, expires } : null;
}

/**
 * @param {ShopifyAuth & { kind: 'client-credentials' }} auth
 * @param {TokenContext} context
 * @returns {TokenSource}
 */
function clientCredentialsTokens(auth, { shop, fetchImpl, now, tokenStore }) {
  /** @type {AccessToken | null} */
  let cached = null;
  /** @param {AccessToken} token */
  const fresh = (token) => token.expires > now() + TOKEN_MARGIN_MS;

  async function request() {
    const res = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
      }).toString(),
    });
    if (!res.ok)
      throw new SyncError(`Shopify token request failed (${String(res.status)})`, {
        status: res.status,
        body: await res.text(),
      });
    const token = parseAccessToken(await responseJsonOrNull(res), now());
    if (tokenStore) await tokenStore.put(TOKEN_KEY, await seal(auth.clientSecret, TOKEN_PURPOSE, TOKEN_KEY, token));
    cached = token;
    return token.token;
  }

  /** @returns {Promise<AccessToken | null>} */
  async function stored() {
    if (!tokenStore) return null;
    return parseCachedToken(await open(auth.clientSecret, TOKEN_PURPOSE, TOKEN_KEY, await tokenStore.get(TOKEN_KEY)));
  }

  return {
    async current() {
      if (cached && fresh(cached)) return cached.token;
      if (!cached) {
        const saved = await stored();
        if (saved && fresh(saved)) {
          cached = saved;
          return saved.token;
        }
      }
      return request();
    },
    // A 401 means the token was revoked: the stored copy goes too, so no later run reads it again.
    async replace() {
      cached = null;
      if (tokenStore) await tokenStore.delete(TOKEN_KEY);
      return request();
    },
  };
}

/**
 * @param {{ adminToken?: string | undefined, clientId?: string | undefined, clientSecret?: string | undefined }} settings
 * @param {TokenContext} context
 * @returns {TokenSource}
 * @throws {SyncError} When neither an admin token nor both client credentials are set.
 */
export function tokenSource(settings, context) {
  const auth = authFrom(settings);
  if (auth.kind === 'client-credentials') return clientCredentialsTokens(auth, context);
  return { current: () => Promise.resolve(auth.token), replace: null };
}
