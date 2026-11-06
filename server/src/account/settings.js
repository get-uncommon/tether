/** The customer-account settings of the Worker, read once from its env. */

import { STOREFRONT_API_VERSION } from '../shared/api-versions.js';
import { cleanEnv } from '../env.js';

/**
 * What the requests to Shopify need.
 *
 * @typedef {object} ShopifyAccountSettings
 * @property {string} clientId Customer Account API client id (Headless channel).
 * @property {string} clientSecret Only for a confidential client; `''` for a public one.
 * @property {string} shopDomain The store's domain, as a bare host name.
 * @property {string} storefrontToken The public Storefront token, used to link carts; `''` when not set.
 * @property {string} apiVersion Storefront API version for cart links.
 */

/**
 * The root of every sealing key. `SYNC_SECRET` is the fallback for Workers set up before `ACCOUNT_SECRET` existed:
 * changing the key logs every customer out, so it stays usable, with a warning.
 *
 * @typedef {{ kind: 'missing' } | { kind: 'set', value: string, source: 'ACCOUNT_SECRET' | 'SYNC_SECRET' }} AccountSecret
 */

/**
 * How long a login lasts. `replaced`: ACCOUNT_SESSION_DAYS was set to something unusable, and `days` is used instead.
 *
 * @typedef {{ kind: 'as-set', days: number }
 *   | { kind: 'replaced', days: number, raw: string, reason: 'not a whole number' | 'outside 1 to 90' }} SessionDays
 */

/**
 * @typedef {ShopifyAccountSettings & {
 *   origins: string[],
 *   secret: AccountSecret,
 *   sessionDays: SessionDays,
 * }} AccountSettings
 *   `origins`: the site's https origins, without a trailing slash, the first being the site's home.
 */

/**
 * Settings {@link accountProblems} finds no error in, flattened to what the routes use.
 *
 * @typedef {ShopifyAccountSettings & {
 *   origins: [string, ...string[]],
 *   secret: string,
 *   sessionDays: number,
 * }} ReadyAccountSettings
 */

/** @typedef {{ severity: 'error' | 'warning', message: string }} AccountProblem */

const DEFAULT_SESSION_DAYS = 14;
const MAX_SESSION_DAYS = 90;
const WHOLE_NUMBER = /^\d+$/;
/** A DNS host name: dot-separated labels of letters, digits and inner hyphens. */
const HOST_NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * @param {string | undefined} raw ACCOUNT_SESSION_DAYS.
 * @returns {SessionDays}
 */
function sessionDaysOf(raw) {
  if (raw === undefined) return { kind: 'as-set', days: DEFAULT_SESSION_DAYS };
  if (!WHOLE_NUMBER.test(raw)) {
    return { kind: 'replaced', days: DEFAULT_SESSION_DAYS, raw, reason: 'not a whole number' };
  }
  const days = Number(raw);
  if (days >= 1 && days <= MAX_SESSION_DAYS) return { kind: 'as-set', days };
  return { kind: 'replaced', days: Math.max(1, Math.min(MAX_SESSION_DAYS, days)), raw, reason: 'outside 1 to 90' };
}

/**
 * @param {import('../env.js').CleanEnv} env
 * @returns {AccountSecret}
 */
function secretOf(env) {
  if (env.ACCOUNT_SECRET) return { kind: 'set', value: env.ACCOUNT_SECRET, source: 'ACCOUNT_SECRET' };
  if (env.SYNC_SECRET) return { kind: 'set', value: env.SYNC_SECRET, source: 'SYNC_SECRET' };
  return { kind: 'missing' };
}

/**
 * @param {Record<string, unknown>} rawEnv
 * @returns {AccountSettings | null} `null` when accounts are off (no ACCOUNT_CLIENT_ID).
 */
export function accountSettings(rawEnv) {
  const env = cleanEnv(rawEnv);
  if (!env.ACCOUNT_CLIENT_ID) return null;
  return {
    clientId: env.ACCOUNT_CLIENT_ID,
    clientSecret: env.ACCOUNT_CLIENT_SECRET ?? '',
    origins: (env.ACCOUNT_ORIGINS ?? '')
      .split(/[\s,]+/)
      .map((origin) => origin.replace(/\/$/, ''))
      .filter(Boolean),
    shopDomain: (env.SHOPIFY_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    storefrontToken: env.STOREFRONT_TOKEN ?? '',
    secret: secretOf(env),
    sessionDays: sessionDaysOf(env.ACCOUNT_SESSION_DAYS),
    apiVersion: env.STOREFRONT_API_VERSION ?? STOREFRONT_API_VERSION,
  };
}

/**
 * The problems of the settings that are not about the secret.
 *
 * @param {AccountSettings} settings
 * @param {(message: string) => void} error
 * @param {(message: string) => void} warning
 */
function siteAndShopProblems(settings, error, warning) {
  if (!settings.origins.length) error('ACCOUNT_ORIGINS is missing: your site, e.g. https://shop.com');
  if (settings.origins.some((origin) => !/^https:\/\/[^/]+$/.test(origin))) {
    error('ACCOUNT_ORIGINS must be https origins without a path, e.g. https://shop.com');
  }
  if (!settings.shopDomain) error('SHOPIFY_DOMAIN is missing');
  else if (!HOST_NAME.test(settings.shopDomain)) {
    error('SHOPIFY_DOMAIN must be the store domain alone, e.g. your-store.myshopify.com');
  }
  const { sessionDays } = settings;
  if (sessionDays.kind === 'replaced') {
    warning(
      `ACCOUNT_SESSION_DAYS "${sessionDays.raw}" is ${sessionDays.reason}: logins last ${String(sessionDays.days)} days`,
    );
  }
  if (!settings.storefrontToken) {
    warning(
      "STOREFRONT_TOKEN (the public Storefront token) is missing: carts can't be linked, so checkout won't know the customer",
    );
  }
}

/**
 * What stops accounts from working (`error`) or weakens them (`warning`). Empty when all is set.
 *
 * @param {AccountSettings} settings
 * @returns {AccountProblem[]}
 */
export function accountProblems(settings) {
  /** @type {AccountProblem[]} */
  const problems = [];
  const error = (/** @type {string} */ message) => problems.push({ severity: 'error', message });
  const warning = (/** @type {string} */ message) => problems.push({ severity: 'warning', message });
  siteAndShopProblems(settings, error, warning);
  const { secret } = settings;
  if (secret.kind === 'missing') {
    error('ACCOUNT_SECRET (24+ random characters) is needed: the session encryption key comes from it');
  } else if (secret.source === 'SYNC_SECRET') {
    warning(
      'Sessions are encrypted with a key from SYNC_SECRET, the password for /reconcile and /check, so anyone who has ' +
        'that password can read customer sessions. Set ACCOUNT_SECRET (24+ random characters) to separate them; ' +
        'changing it logs every customer out once.',
    );
  }
  return problems;
}

/**
 * The settings once nothing stops accounts from working, or the errors that do.
 *
 * @param {AccountSettings} settings
 * @returns {{ kind: 'ready', settings: ReadyAccountSettings } | { kind: 'not-ready', errors: AccountProblem[] }}
 */
export function readyAccountSettings(settings) {
  const errors = accountProblems(settings).filter((problem) => problem.severity === 'error');
  const { origins, secret, sessionDays } = settings;
  const [home, ...others] = origins;
  // accountProblems reports each of these as an error, so they are only missing alongside one.
  if (errors.length || home === undefined || secret.kind === 'missing') return { kind: 'not-ready', errors };
  return {
    kind: 'ready',
    settings: { ...settings, origins: [home, ...others], secret: secret.value, sessionDays: sessionDays.days },
  };
}
