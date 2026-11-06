/**
 * What tells a page that customer accounts are in use in this browser: the Web Storage keys the account part keeps,
 * and the Worker's `?account=` mark after a login. The core reads them to decide whether a page loads the part, and
 * the part writes them, so both take them from here.
 */
import { cfg } from './config.js';

/**
 * What the Worker's login redirect says in `?account=`: `in` after a login, `expired` when the login took too long,
 * `error` when it failed.
 *
 * @typedef {'in' | 'expired' | 'error'} LoginOutcome
 */

/** @returns {string} The browser-mode session's key. */
export const sessionKey = () => `${cfg.prefix}:account:${cfg.domain}`;

/** @returns {string} The key of the login in progress (browser mode), between leaving for Shopify and coming back. */
export const pendingLoginKey = () => `${cfg.prefix}:account-login:${cfg.domain}`;

/**
 * Server mode's "may be logged in" mark: it makes the core load the part on the next page, and holds no secret.
 *
 * @returns {string}
 */
export const hintKey = () => `${cfg.prefix}:account-hint:${cfg.domain}`;

/**
 * @param {string | null} value
 * @returns {value is LoginOutcome}
 */
export const isLoginOutcome = (value) => value === 'in' || value === 'expired' || value === 'error';
