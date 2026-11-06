/**
 * What tells a page that customer accounts are in use in this browser: the "may be logged in" hint the account part
 * keeps in `localStorage`, and the Worker's `?account=` mark after a login. The core reads them to decide whether a
 * page loads the part, and the part writes the hint, so both take them from here.
 */
import { cfg } from './config.ts';
import { removeStored } from './storage.ts';

/**
 * What the Worker's login redirect says in `?account=`: `in` after a login, `expired` when the login took too long,
 * `error` when it failed.
 */
type LoginOutcome = 'in' | 'expired' | 'error';

/** The "may be logged in" hint's key: it makes the core load the part on the next page, and holds no secret. */
export const hintKey = (): string => `${cfg.prefix}:account-hint:${cfg.domain}`;

/** Removes a key from both storage areas, each on its own: a blocked one doesn't keep the key in the other. */
function removeFromBothAreas(key: string): void {
  removeStored(key, 'sessionStorage');
  removeStored(key, 'localStorage');
}

/**
 * Removes the customer tokens and pending login that Tether 0.6's browser-mode accounts kept in this browser. The
 * session held a refresh token with the customer's full scope, so it must not stay behind once accounts run through
 * the Worker. TODO: remove in 0.8.0, when no visitor's browser still holds a 0.6 session.
 */
export function forgetBrowserModeTokens(): void {
  removeFromBothAreas(`${cfg.prefix}:account:${cfg.domain}`);
  removeFromBothAreas(`${cfg.prefix}:account-login:${cfg.domain}`);
}

export const isLoginOutcome = (value: string | null): value is LoginOutcome =>
  value === 'in' || value === 'expired' || value === 'error';
