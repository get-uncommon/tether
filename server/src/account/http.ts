/** Cookies, CORS and responses for the account routes. */

import type { ReadyAccountSettings } from './settings.ts';
import { asRecord, responseJsonOrNull } from '../json.ts';

/** The session cookie: an opaque random id; the session itself is sealed in KV under its hash. */
export const SESSION_COOKIE = '__Host-tether-account';
/** The pending login, sealed, in the browser that started it. */
export const LOGIN_COOKIE = '__Host-tether-login';
/** One-time: the id token for Shopify's logout, never readable by scripts. */
export const LOGOUT_COOKIE = '__Host-tether-logout';

/** Response headers on every account answer. */
export const NO_STORE = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/**
 * A cookie's value, when it is present and looks like one of ours (base64url and dots, 20 to `maxLength` long).
 */
export function readCookie(request: Request, name: string, maxLength: number): string | null {
  const pattern = new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_.-]{20,${maxLength}})`);
  return pattern.exec(request.headers.get('cookie') ?? '')?.[1] ?? null;
}

/**
 * A `Set-Cookie` value. `maxAgeSeconds` 0 deletes the cookie.
 *
 * `SameSite=Lax` for all three: the login comes back from Shopify as a cross-site top-level navigation to the
 * callback, which needs the login cookie, and also the session cookie, to end the session this browser already had
 * before replacing it. `Strict` would withhold both there. The other routes don't rely on SameSite against CSRF:
 * they need an allowed Origin, and POSTs a custom header that forces a CORS preflight.
 */
export function setCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/**
 * The CORS headers for a request from an allowed origin, or `null` when the origin isn't allowed.
 *
 * Same-origin GETs (the Worker on the site's own domain) carry no Origin header; the browser marks them with
 * Sec-Fetch-Site, which pages can't set. Everything else needs an allowed Origin.
 */
export function corsHeaders(
  request: Request,
  settings: Pick<ReadyAccountSettings, 'origins'>,
): Record<string, string> | null {
  const origin = request.headers.get('origin');
  if (!origin && request.headers.get('sec-fetch-site') === 'same-origin') {
    return settings.origins.includes(new URL(request.url).origin) ? { Vary: 'Origin' } : null;
  }
  if (!origin || !settings.origins.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Tether-Account',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...NO_STORE, ...headers },
  });
}

export function redirectResponse(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...NO_STORE, ...headers } });
}

/** `raw` when it is an address on one of the site's origins, else the site's home: no open redirects. */
export function safeReturn(raw: string, settings: ReadyAccountSettings): string {
  try {
    const url = new URL(raw);
    if (settings.origins.includes(url.origin) && url.href.length < 2048) return url.href;
  } catch {
    // Not an absolute URL: the site's home below.
  }
  return `${settings.origins[0]}/`;
}

/** A Storefront cart id, as the browser sends it to link or unlink a cart. */
export const CART_ID = /^gid:\/\/shopify\/Cart\/[\w-]+(\?key=[\w-]+)?$/;

/** The request body as a JSON object; `{}` for a body that is not one, whose fields the routes then refuse one by one. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  return asRecord(await responseJsonOrNull(request));
}
