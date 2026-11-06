/** The customer-account settings of the Worker, read once from its env. */

import { STOREFRONT_API_VERSION } from '../shared/api-versions.js';
import { cleanEnv } from '../env.js';

/**
 * @typedef {object} AccountSettings
 * @property {string} clientId Customer Account API client id (Headless channel).
 * @property {string} clientSecret Only for a confidential client; `''` for a public one.
 * @property {string[]} origins The site's https origins, without a trailing slash. The first is the site's home.
 * @property {string} shopDomain The store's `.myshopify.com` domain.
 * @property {string} storefrontToken The public Storefront token, used to link carts; `''` when not set.
 * @property {string} secret The root of every sealing key; `''` when neither secret is set.
 * @property {'ACCOUNT_SECRET' | 'SYNC_SECRET' | null} secretSource Which setting `secret` came from.
 * @property {number} sessionDays How long a login lasts, 1 to 90 days.
 * @property {string} apiVersion Storefront API version for cart links.
 */

/**
 * Settings {@link accountProblems} finds no error in: the site has a home origin.
 *
 * @typedef {AccountSettings & { origins: [string, ...string[]] }} ReadyAccountSettings
 */

/** @typedef {{ severity: 'error' | 'warning', message: string }} AccountProblem */

const DEFAULT_SESSION_DAYS = 14;
const MAX_SESSION_DAYS = 90;

/**
 * @param {Record<string, unknown>} rawEnv
 * @returns {AccountSettings | null} `null` when accounts are off (no ACCOUNT_CLIENT_ID).
 */
export function accountSettings(rawEnv) {
  const env = cleanEnv(rawEnv);
  if (!env.ACCOUNT_CLIENT_ID) return null;
  const sessionDays = parseInt(env.ACCOUNT_SESSION_DAYS ?? '', 10) || DEFAULT_SESSION_DAYS;
  /** @type {AccountSettings['secretSource']} */
  let secretSource = null;
  if (env.ACCOUNT_SECRET) secretSource = 'ACCOUNT_SECRET';
  else if (env.SYNC_SECRET) secretSource = 'SYNC_SECRET';
  return {
    clientId: env.ACCOUNT_CLIENT_ID,
    clientSecret: env.ACCOUNT_CLIENT_SECRET ?? '',
    origins: (env.ACCOUNT_ORIGINS ?? '')
      .split(/[\s,]+/)
      .map((origin) => origin.replace(/\/$/, ''))
      .filter(Boolean),
    shopDomain: (env.SHOPIFY_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    storefrontToken: env.STOREFRONT_TOKEN ?? '',
    secret: (secretSource && env[secretSource]) ?? '',
    secretSource,
    sessionDays: Math.max(1, Math.min(MAX_SESSION_DAYS, sessionDays)),
    apiVersion: env.STOREFRONT_API_VERSION ?? STOREFRONT_API_VERSION,
  };
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
  if (!settings.origins.length) error('ACCOUNT_ORIGINS is missing: your site, e.g. https://shop.com');
  if (settings.origins.some((origin) => !/^https:\/\/[^/]+$/.test(origin))) {
    error('ACCOUNT_ORIGINS must be https origins without a path, e.g. https://shop.com');
  }
  if (!settings.shopDomain) error('SHOPIFY_DOMAIN is missing');
  if (!settings.secret) {
    error('ACCOUNT_SECRET (24+ random characters) is needed: the session encryption key comes from it');
  } else if (settings.secretSource === 'SYNC_SECRET') {
    warning(
      'Sessions are encrypted with a key from SYNC_SECRET, which is also the password for /reconcile and /check. ' +
        'Set ACCOUNT_SECRET (24+ random characters) so the two are separate. Changing it logs every customer out once.',
    );
  }
  if (!settings.storefrontToken) {
    warning(
      "STOREFRONT_TOKEN (the public Storefront token) is missing: carts can't be linked, so checkout won't know the customer",
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
  const [home, ...others] = settings.origins;
  // accountProblems reports an empty ACCOUNT_ORIGINS as an error, so `home` is only missing alongside one.
  if (errors.length || home === undefined) return { kind: 'not-ready', errors };
  return { kind: 'ready', settings: { ...settings, origins: [home, ...others] } };
}
