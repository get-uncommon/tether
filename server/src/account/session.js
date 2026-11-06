/**
 * Customer sessions. A session is sealed in KV under the SHA-256 of a random id; the browser only holds the id, in an
 * HttpOnly cookie. Sessions have an absolute lifetime and are never extended past it.
 */

/** @import { ExpiringStore } from './kv.js' */
/** @import { AccountSettings } from './settings.js' */
/** @import { Discovery, Fetch } from './shopify.js' */

import { open, seal, sha256, toHex } from '../crypto.js';
import { discover, SessionEndedError, tokenRequest } from './shopify.js';

/**
 * @typedef {object} Session
 * @property {string} access The Customer Account API access token.
 * @property {string | null} refresh The refresh token, when Shopify issued one.
 * @property {string} idToken For Shopify's logout.
 * @property {number} createdAt Epoch ms of the login; the lifetime counts from here.
 * @property {number} expiresAt Epoch ms when `access` expires.
 */

/** Refresh this long before the access token expires, so parallel requests rarely race a refresh. */
const REFRESH_MARGIN_MS = 5 * 60e3;
/** A token answer without `expires_in` is taken to last this long. */
const DEFAULT_TOKEN_SECONDS = 3600;
/** How long, and how often, to wait for a refresh another request started. */
const REFRESH_WAIT_ATTEMPTS = 3;
const REFRESH_WAIT_MS = 300;

/** @param {unknown} value @returns {value is Session} */
function isSession(value) {
  if (value === null || typeof value !== 'object') return false;
  const session = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof session['access'] === 'string' &&
    (session['refresh'] === null || typeof session['refresh'] === 'string') &&
    typeof session['idToken'] === 'string' &&
    typeof session['createdAt'] === 'number' &&
    typeof session['expiresAt'] === 'number'
  );
}

/**
 * The session fields a token answer gives.
 *
 * @param {import('./shopify.js').TokenSet} tokens
 * @param {Pick<Session, 'refresh' | 'idToken'>} previous What to keep when the answer omits it.
 */
export function sessionTokens(tokens, previous) {
  return {
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? previous.refresh,
    idToken: tokens.id_token ?? previous.idToken,
    expiresAt: Date.now() + (Number(tokens.expires_in) || DEFAULT_TOKEN_SECONDS) * 1000,
  };
}

/**
 * @param {object} options
 * @param {ExpiringStore} options.store
 * @param {AccountSettings} options.settings
 * @param {Fetch} options.fetch
 */
export function createSessionStore({ store, settings, fetch: fetchImpl }) {
  const lifetimeMs = settings.sessionDays * 86400e3;
  const keyOf = async (/** @type {string} */ id) => `s:${toHex(await sha256(id))}`;

  /** @param {string} id @returns {Promise<Session | null>} */
  async function load(id) {
    const key = await keyOf(id);
    const session = await open(settings.secret, 'session', key, await store.get(key));
    if (!isSession(session)) return null;
    if (Date.now() - session.createdAt > lifetimeMs) {
      await store.delete(key);
      return null;
    }
    return session;
  }

  /** @param {string} id @param {Session} session */
  async function save(id, session) {
    const key = await keyOf(id);
    const secondsLeft = Math.ceil((session.createdAt + lifetimeMs - Date.now()) / 1000);
    await store.put(key, await seal(settings.secret, 'session', key, session), secondsLeft);
  }

  /** @param {string} id */
  async function end(id) {
    await store.delete(await keyOf(id));
  }

  /**
   * The session with an access token that is good for a while, refreshing it when needed. `null` when Shopify
   * refuses the refresh and no parallel request recovered it: the session is then ended.
   *
   * @param {string} id
   * @param {Session} session
   * @param {string} origin
   * @returns {Promise<Session | null>}
   */
  async function fresh(id, session, origin) {
    if (session.expiresAt > Date.now() + REFRESH_MARGIN_MS) return session;
    /** @type {Discovery} */
    const discovery = await discover(settings, fetchImpl);
    try {
      const tokens = await tokenRequest(
        settings,
        discovery,
        { grant_type: 'refresh_token', refresh_token: session.refresh ?? '' },
        origin,
        fetchImpl,
      );
      const next = { ...session, ...sessionTokens(tokens, session) };
      await save(id, next);
      return next;
    } catch (error) {
      if (!(error instanceof SessionEndedError)) throw error;
      // Shopify rotates the refresh token, so a request refreshing at the same moment as another is refused. Wait
      // for the other one's result before ending the session.
      for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));
        const now = await load(id);
        if (!now) return null;
        if (now.refresh !== session.refresh) return now;
      }
      await end(id);
      return null;
    }
  }

  return { load, save, end, fresh };
}
