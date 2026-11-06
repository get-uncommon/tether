/**
 * What tells a page that customer accounts are in use in this browser: the "may be logged in" hint the account part
 * keeps in `localStorage`, and the Worker's `?account=` mark after a login. The core reads them to decide whether a
 * page loads the part, and the part writes the hint, so both take them from here.
 */
import { cfg } from './config.js';

/**
 * What the Worker's login redirect says in `?account=`: `in` after a login, `expired` when the login took too long,
 * `error` when it failed.
 *
 * @typedef {'in' | 'expired' | 'error'} LoginOutcome
 */

/**
 * The "may be logged in" hint's key: it makes the core load the part on the next page, and holds no secret.
 *
 * @returns {string}
 */
export const hintKey = () => `${cfg.prefix}:account-hint:${cfg.domain}`;

/**
 * @param {string | null} value
 * @returns {value is LoginOutcome}
 */
export const isLoginOutcome = (value) => value === 'in' || value === 'expired' || value === 'error';
