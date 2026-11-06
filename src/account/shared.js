/**
 * What both account modes share: the storage keys, the redirect to Shopify's pages, the login language, and reading
 * the JSON that Shopify and the Worker answer with. Storage throws in private mode and where the visitor blocks site
 * data; a login then lasts as long as the page.
 */
import { cfg } from '../config.js';

/** @typedef {'session' | 'local'} StorageArea */

/** @returns {string} The browser-mode session's key. */
export const sessionKey = () => `${cfg.prefix}:account:${cfg.domain}`;

/** @returns {string} The key of the login in progress (browser mode), between leaving for Shopify and coming back. */
export const pendingLoginKey = () => `${cfg.prefix}:account-login:${cfg.domain}`;

/**
 * Server mode's "may be logged in" mark: it makes the core load this part on the next page, and holds no secret.
 *
 * @returns {string}
 */
const hintKey = () => `${cfg.prefix}:account-hint:${cfg.domain}`;

/** @returns {StorageArea} Where the browser-mode session lives: `localStorage` with `account.remember`. */
export const sessionArea = () => (cfg.account?.remember ? 'local' : 'session');

/** @param {StorageArea} area */
const storageOf = (area) => (area === 'local' ? window.localStorage : window.sessionStorage);

/**
 * @param {StorageArea} area
 * @param {string} key
 * @returns {unknown} The stored JSON value; `null` without one, for text that isn't JSON, or with storage blocked.
 */
export function readJsonIfAllowed(area, key) {
  try {
    return JSON.parse(storageOf(area).getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/**
 * Keeps `value` as JSON; without storage nothing is kept (see the file's comment).
 *
 * @param {StorageArea} area
 * @param {string} key
 * @param {unknown} value `null` removes the key.
 */
export function writeJsonIfAllowed(area, key, value) {
  try {
    if (value === null) storageOf(area).removeItem(key);
    else storageOf(area).setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: see the file's comment.
  }
}

/** @param {boolean} loggedIn */
export function setLoginHint(loggedIn) {
  writeJsonIfAllowed('local', hintKey(), loggedIn ? 1 : null);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export const textOrNull = (value) => (typeof value === 'string' ? value : null);

/**
 * An error page that isn't JSON reads as an empty answer: the response's status then says what went wrong.
 *
 * @param {Response} response
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJsonObjectOrEmpty(response) {
  /** @type {unknown} */
  let json;
  try {
    json = await response.json();
  } catch {
    return {};
  }
  return isRecord(json) ? json : {};
}

/**
 * Goes to one of Shopify's (or the Worker's) pages, through `account.navigate` when the site replaces the redirect.
 *
 * @param {string} url
 */
export function navigate(url) {
  const replacement = cfg.account?.navigate;
  if (replacement) replacement(url);
  else window.location.assign(url);
}

/**
 * @param {string | undefined} locale The caller's choice.
 * @returns {string} The language of Shopify's login page: the caller's, `account.locale`, else the site's; `''` for
 *   Shopify's default.
 */
export const loginLanguage = (locale) => locale || cfg.account?.locale || (cfg.locale || '').split('-')[0] || '';

/** @returns {string} The market's country for Shopify's login page, `''` without one. */
export const loginCountry = () => (cfg.country ? cfg.country.toUpperCase() : '');
