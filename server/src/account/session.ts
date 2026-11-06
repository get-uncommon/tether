/**
 * Customer sessions. A session is sealed in KV under the SHA-256 of a random id; the browser only holds the id, in an
 * HttpOnly cookie. Sessions have an absolute lifetime and are never extended past it.
 */

import type { ExpiringStore } from './kv.ts';
import type { ReadyAccountSettings } from './settings.ts';
import type { Fetch } from './shopify.ts';
import type { TokenAnswer } from './token-answer.ts';
import { isRecord } from '../shared/json.ts';
import { open, seal, sha256, toHex } from '../crypto.ts';
import { discover, SessionEndedError, tokenRequest } from './shopify.ts';

export interface Session {
  /** The Customer Account API access token. */
  access: string;
  /** The refresh token, when Shopify issued one. */
  refresh: string | null;
  /** For Shopify's logout. */
  idToken: string;
  /** Epoch ms of the login; the lifetime counts from here. */
  createdAt: number;
  /** Epoch ms when `access` expires. */
  expiresAt: number;
}

/** Refresh this long before the access token expires, so parallel requests rarely race a refresh. */
const REFRESH_MARGIN_MS = 5 * 60e3;
/** A token answer without `expires_in` is taken to last this long. */
const DEFAULT_TOKEN_SECONDS = 3600;
/**
 * How long, and how often, to wait for a refresh that a request in another isolate started. KV is eventually
 * consistent across locations, so this only recovers a race within one location; elsewhere the customer logs in again.
 */
const REFRESH_WAIT_ATTEMPTS = 3;
const REFRESH_WAIT_MS = 300;

function isSession(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  return (
    typeof value['access'] === 'string' &&
    (value['refresh'] === null || typeof value['refresh'] === 'string') &&
    typeof value['idToken'] === 'string' &&
    typeof value['createdAt'] === 'number' &&
    typeof value['expiresAt'] === 'number'
  );
}

/**
 * The session fields a token answer gives.
 *
 * @param previous What to keep when the answer omits it.
 */
export function sessionTokens(
  tokens: TokenAnswer,
  previous: Pick<Session, 'refresh' | 'idToken'>,
): Omit<Session, 'createdAt'> {
  return {
    access: tokens.accessToken,
    refresh: tokens.refreshToken ?? previous.refresh,
    idToken: tokens.idToken ?? previous.idToken,
    expiresAt: Date.now() + (tokens.expiresInSeconds ?? DEFAULT_TOKEN_SECONDS) * 1000,
  };
}

/**
 * Refreshes in progress in this isolate, by session key: parallel requests of one page share one refresh instead of
 * racing Shopify's refresh-token rotation.
 */
const refreshing = new Map<string, Promise<Session | null>>();

export function createSessionStore({
  store,
  settings,
  fetch: fetchImpl,
}: {
  store: ExpiringStore;
  settings: ReadyAccountSettings;
  fetch: Fetch;
}) {
  const lifetimeMs = settings.sessionDays * 86400e3;
  const keyOf = async (id: string) => `s:${toHex(await sha256(id))}`;

  async function load(id: string): Promise<Session | null> {
    const key = await keyOf(id);
    const session = await open(settings.secret, 'session', key, await store.get(key));
    if (!isSession(session)) return null;
    if (Date.now() - session.createdAt > lifetimeMs) {
      await store.delete(key);
      return null;
    }
    return session;
  }

  async function save(id: string, session: Session): Promise<void> {
    const key = await keyOf(id);
    const secondsLeft = Math.ceil((session.createdAt + lifetimeMs - Date.now()) / 1000);
    await store.put(key, await seal(settings.secret, 'session', key, session), secondsLeft);
  }

  async function end(id: string): Promise<void> {
    await store.delete(await keyOf(id));
  }

  /**
   * The session with an access token that is good for a while, refreshing it when needed. `null` when Shopify
   * refuses the refresh and no parallel request recovered it: the session is then ended.
   */
  async function fresh(id: string, session: Session, origin: string): Promise<Session | null> {
    if (session.expiresAt > Date.now() + REFRESH_MARGIN_MS) return session;
    const key = await keyOf(id);
    const running = refreshing.get(key);
    if (running) return running;
    const refresh = refreshNow(id, session, origin).finally(() => refreshing.delete(key));
    refreshing.set(key, refresh);
    return refresh;
  }

  async function refreshNow(id: string, session: Session, origin: string): Promise<Session | null> {
    const { refresh } = session;
    // Without a refresh token from Shopify, the session lasts as long as its access token.
    if (refresh === null) {
      if (session.expiresAt > Date.now()) return session;
      await end(id);
      return null;
    }
    const discovery = await discover(settings, fetchImpl);
    try {
      const tokens = await tokenRequest(
        settings,
        discovery,
        { grant_type: 'refresh_token', refresh_token: refresh },
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
