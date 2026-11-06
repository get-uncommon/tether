/**
 * The Shopify Admin API access token: a static admin token, or one from the client credentials grant, cached in
 * memory and, sealed, in the store between runs.
 */
import { SyncError } from './util.ts';
import { open, seal } from './crypto.ts';
import { asRecord, responseJsonOrNull } from './json.ts';

import type { Store } from './store.ts';

// The client-credentials token is cached sealed with the client secret, which only Worker secrets hold: KV values
// can be read in Cloudflare's dashboard, secrets can't.
const TOKEN_KEY = 'shopify:token';
const TOKEN_PURPOSE = 'shopify-token';
/** A token this close to its expiry is fetched again rather than used. */
const TOKEN_MARGIN_MS = 60_000;
/** Shopify's client-credentials tokens last a day; used when the answer leaves `expires_in` out. */
const DEFAULT_TOKEN_SECONDS = 86_399;

/** `expires` is a `Date.now()` time. */
interface AccessToken {
  token: string;
  expires: number;
}

type ShopifyAuth =
  { kind: 'admin-token'; token: string } | { kind: 'client-credentials'; clientId: string; clientSecret: string };

/** Where the access token comes from. `replace` is `null` for a static admin token, which a 401 cannot fix. */
interface TokenSource {
  current: () => Promise<string>;
  replace: (() => Promise<string>) | null;
}

interface TokenContext {
  shop: string;
  fetchImpl: typeof fetch;
  now: () => number;
  tokenStore: Store | null;
}

interface AuthSettings {
  adminToken?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

function authFrom({ adminToken, clientId, clientSecret }: AuthSettings): ShopifyAuth {
  if (adminToken) return { kind: 'admin-token', token: adminToken };
  if (clientId && clientSecret) return { kind: 'client-credentials', clientId, clientSecret };
  throw new SyncError('Shopify auth missing: set SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET');
}

/** @param json The token endpoint's answer. */
function parseAccessToken(json: unknown, now: number): AccessToken {
  const { access_token: token, expires_in: seconds } = asRecord(json);
  if (typeof token !== 'string' || !token) throw new SyncError('Shopify token response has no access_token');
  const lifetime = typeof seconds === 'number' && seconds > 0 ? seconds : DEFAULT_TOKEN_SECONDS;
  return { token, expires: now + lifetime * 1000 };
}

/**
 * A token cached by an earlier run, or `null` when the stored value is missing, unreadable or of another shape.
 *
 * @param saved What `open` returned.
 */
function parseCachedToken(saved: unknown): AccessToken | null {
  const { token, expires } = asRecord(saved);
  return typeof token === 'string' && token && typeof expires === 'number' ? { token, expires } : null;
}

function clientCredentialsTokens(
  auth: ShopifyAuth & { kind: 'client-credentials' },
  { shop, fetchImpl, now, tokenStore }: TokenContext,
): TokenSource {
  let cached: AccessToken | null = null;
  const fresh = (token: AccessToken) => token.expires > now() + TOKEN_MARGIN_MS;

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

  async function stored(): Promise<AccessToken | null> {
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

/** @throws {SyncError} When neither an admin token nor both client credentials are set. */
export function tokenSource(settings: AuthSettings, context: TokenContext): TokenSource {
  const auth = authFrom(settings);
  if (auth.kind === 'client-credentials') return clientCredentialsTokens(auth, context);
  return { current: () => Promise.resolve(auth.token), replace: null };
}
