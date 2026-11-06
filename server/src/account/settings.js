/** The customer-account settings of the Worker, read once from its env. */

/**
 * @typedef {object} AccountSettings
 * @property {string} clientId Customer Account API client id (Headless channel).
 * @property {string} clientSecret Only for a confidential client; `''` for a public one.
 * @property {string[]} origins The site's https origins, without a trailing slash. The first is the site's home.
 * @property {string} shopDomain The store's `.myshopify.com` domain.
 * @property {string} storefrontToken The public Storefront token, used to link carts; `''` when not set.
 * @property {string} secret The root of every sealing key: ACCOUNT_SECRET, else SYNC_SECRET.
 * @property {number} sessionDays How long a login lasts, 1 to 90 days.
 * @property {string} apiVersion Storefront API version for cart links.
 */

/** @typedef {{ severity: 'error' | 'warning', message: string }} AccountProblem */

/** @param {unknown} value */
function settingValue(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^(none|-|null|undefined)$/i.test(text) ? '' : text;
}

/**
 * @param {Record<string, unknown>} env
 * @returns {AccountSettings | null} `null` when accounts are off (no ACCOUNT_CLIENT_ID).
 */
export function accountSettings(env) {
  const clientId = settingValue(env['ACCOUNT_CLIENT_ID']);
  if (!clientId) return null;
  const sessionDays = parseInt(settingValue(env['ACCOUNT_SESSION_DAYS']) || '14', 10) || 14;
  return {
    clientId,
    clientSecret: settingValue(env['ACCOUNT_CLIENT_SECRET']),
    origins: settingValue(env['ACCOUNT_ORIGINS'])
      .split(/[\s,]+/)
      .map((origin) => origin.replace(/\/$/, ''))
      .filter(Boolean),
    shopDomain: settingValue(env['SHOPIFY_DOMAIN'])
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, ''),
    storefrontToken: settingValue(env['STOREFRONT_TOKEN']),
    secret: settingValue(env['ACCOUNT_SECRET']) || settingValue(env['SYNC_SECRET']),
    sessionDays: Math.max(1, Math.min(90, sessionDays)),
    apiVersion: settingValue(env['STOREFRONT_API_VERSION']) || '2026-07',
  };
}

/**
 * What stops accounts from working (`error`) or limits them (`warning`). Empty when all is set.
 *
 * @param {AccountSettings} settings
 * @returns {AccountProblem[]}
 */
export function accountProblems(settings) {
  /** @type {AccountProblem[]} */
  const problems = [];
  const error = (/** @type {string} */ message) => problems.push({ severity: 'error', message });
  if (!settings.origins.length) error('ACCOUNT_ORIGINS is missing: your site, e.g. https://shop.com');
  if (settings.origins.some((origin) => !/^https:\/\/[^/]+$/.test(origin))) {
    error('ACCOUNT_ORIGINS must be https origins without a path, e.g. https://shop.com');
  }
  if (!settings.shopDomain) error('SHOPIFY_DOMAIN is missing');
  if (settings.secret.length < 24) {
    error('SYNC_SECRET or ACCOUNT_SECRET (24+ characters) is needed: the session encryption key comes from it');
  }
  if (!settings.storefrontToken) {
    problems.push({
      severity: 'warning',
      message:
        "STOREFRONT_TOKEN (the public Storefront token) is missing: carts can't be linked, so checkout won't know the customer",
    });
  }
  return problems;
}
