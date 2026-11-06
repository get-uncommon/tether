/** Cookies, CORS and responses for the account routes. */

/** @import { AccountSettings } from './settings.js' */

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
 *
 * @param {Request} request
 * @param {string} name
 * @param {number} maxLength
 */
export function readCookie(request, name, maxLength) {
  const pattern = new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_.-]{20,${maxLength}})`);
  return pattern.exec(request.headers.get('cookie') ?? '')?.[1] ?? null;
}

/**
 * A `Set-Cookie` value. `maxAgeSeconds` 0 deletes the cookie.
 *
 * @param {string} name
 * @param {string} value
 * @param {number} maxAgeSeconds
 */
export function setCookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/**
 * The CORS headers for a request from an allowed origin, or `null` when the origin isn't allowed.
 *
 * Same-origin GETs (the Worker on the site's own domain) carry no Origin header; the browser marks them with
 * Sec-Fetch-Site, which pages can't set. Everything else needs an allowed Origin.
 *
 * @param {Request} request
 * @param {AccountSettings} settings
 * @returns {Record<string, string> | null}
 */
export function corsHeaders(request, settings) {
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

/**
 * @param {unknown} data
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...NO_STORE, ...headers },
  });
}

/**
 * @param {string} location
 * @param {Record<string, string>} [headers]
 */
export function redirectResponse(location, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: location, ...NO_STORE, ...headers } });
}

/**
 * `raw` when it is an address on one of the site's origins, else the site's home: no open redirects.
 *
 * @param {string} raw
 * @param {AccountSettings} settings
 */
export function safeReturn(raw, settings) {
  try {
    const url = new URL(raw);
    if (settings.origins.includes(url.origin) && url.href.length < 2048) return url.href;
  } catch {
    // Not an absolute URL: the site's home below.
  }
  return `${settings.origins[0] ?? ''}/`;
}
