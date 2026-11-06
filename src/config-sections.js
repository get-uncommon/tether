/**
 * Parsers for the options with structure, whose values become URLs, credentials, storage names or query text: the
 * store's domain, the metafields and the nested `account`, `markets` and `analytics` objects. `account.server` becomes
 * the base of credentialed requests, so a value of the wrong kind is dropped (with a warning through `invalid`), never
 * used. `config.js` resolves the rest.
 */
import { isRecord } from '../server/src/shared/json.js';
/** @import { AccountConfig, AnalyticsConfig, MarketsConfig, MetafieldIdentifier, MetafieldRef } from './config.js' */

/** @typedef {(name: string, value: unknown) => void} Invalid Warns that an option was dropped. */
/** @typedef {NonNullable<MarketsConfig['locales']>[string]} LocaleMarket */
/** @typedef {Exclude<NonNullable<AnalyticsConfig['shopify']>, boolean>} ShopifyAnalyticsOptions */

/**
 * Metafield identifiers are written into the product fragment's text: a GraphQL fragment can't declare variables, so
 * they can't be sent as variables. Only these characters are let through, which covers Shopify's namespaces and keys.
 */
const METAFIELD_PART = /^[A-Za-z0-9_.-]+$/;
/** A namespace is the same, or an app-reserved one: `$app` or `$app:<name>`. */
const METAFIELD_NAMESPACE = /^(\$app(:[A-Za-z0-9_-]+)?|[A-Za-z0-9_.-]+)$/;
/** A DNS name: labels of letters, digits and inner hyphens. No port, user or path. */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
/** A cookie name, as RFC 6265 allows it. */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** A global variable's name, which `analytics.dataLayer` names. */
const GLOBAL_NAME = /^[A-Za-z_$][\w$]*$/;
/** Stands for the site's own origin, to tell a path on the site from a URL elsewhere. */
const SITE_ORIGIN = 'https://site.invalid';
/** Hosts a developer's own machine answers on, where plain http is the norm (`wrangler dev`). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** @type {readonly ('saved' | 'server' | 'webflow')[]} Every source `markets.detect` reads. */
export const MARKET_SOURCES = ['saved', 'server', 'webflow'];
/** @type {readonly NonNullable<ShopifyAnalyticsOptions['consent']>[]} */
const CONSENT_MODES = ['no-banner', 'default-banner', 'custom-banner'];

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const isText = (value) => typeof value === 'string' && value !== '';

/**
 * A hook the site passes. What it is called with is up to Tether, and what it returns is not used.
 *
 * @param {unknown} value
 * @returns {value is (...args: unknown[]) => unknown}
 */
const isFunction = (value) => typeof value === 'function';

/**
 * @param {unknown} value
 * @param {Invalid} invalid
 * @returns {string} The store's domain without protocol or path (`https://shop.example/x` → `shop.example`), `''` for
 *   anything that isn't a host name.
 */
export function domainOption(value, invalid) {
  if (typeof value !== 'string' || !value) return '';
  const host = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (isHostname(host)) return host;
  invalid('domain', value);
  return '';
}

/**
 * @param {unknown} value
 * @returns {value is string} True for a path on this site, an https URL, or an http one on the developer's machine.
 */
function isSiteOrHttpsUrl(value) {
  if (!isText(value)) return false;
  try {
    const url = new URL(value, `${SITE_ORIGIN}/`);
    if (url.origin === SITE_ORIGIN) return true;
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  } catch {
    // Not a URL at all.
    return false;
  }
}

/**
 * The folder of the optional parts. It must be https or on this site, which keeps parts off plain http (mixed content,
 * rewritable on the way); it doesn't vouch for the host, which the site chose.
 *
 * @param {unknown} value
 * @param {Invalid} invalid
 * @returns {string | null} The folder as written, `null` for none or one elsewhere (the parts then load beside the core).
 */
export function partsUrlOption(value, invalid) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && (isSiteOrHttpsUrl(value) || isPageOrigin(value))) return value;
  invalid('partsUrl', value);
  return null;
}

/**
 * @param {string} value
 * @returns {boolean} True for an absolute URL on the page's own origin (a site served over plain http).
 */
function isPageOrigin(value) {
  if (typeof location === 'undefined') return false;
  try {
    return new URL(value).origin === location.origin;
  } catch {
    // Not an absolute URL: `isSiteOrHttpsUrl` has judged it.
    return false;
  }
}

/**
 * @param {unknown} ref
 * @returns {MetafieldIdentifier | null} The identifier of `'namespace.key'` or `{ namespace, key }`, when both parts are
 *   valid identifiers.
 */
export function toMetafieldIdentifier(ref) {
  /** @type {unknown} */
  let namespace;
  /** @type {unknown} */
  let key;
  if (typeof ref === 'string') {
    const dot = ref.indexOf('.');
    namespace = dot > 0 ? ref.slice(0, dot) : '';
    key = ref.slice(dot + 1);
  } else if (typeof ref === 'object' && ref !== null) {
    namespace = Reflect.get(ref, 'namespace');
    key = Reflect.get(ref, 'key');
  }
  if (typeof namespace !== 'string' || typeof key !== 'string') return null;
  return METAFIELD_NAMESPACE.test(namespace) && METAFIELD_PART.test(key) ? { namespace, key } : null;
}

/**
 * @param {unknown} value
 * @param {Invalid} invalid
 * @returns {MetafieldRef[]} The refs that name a valid identifier, as written; each other one is skipped with a warning.
 */
export function metafieldsOption(value, invalid) {
  if (!Array.isArray(value)) {
    invalid('metafields', value);
    return [];
  }
  /** @type {MetafieldRef[]} */
  const refs = [];
  for (const ref of /** @type {unknown[]} */ (value)) {
    const identifier = toMetafieldIdentifier(ref);
    if (identifier) refs.push(typeof ref === 'string' ? ref : identifier);
    else invalid('metafield', ref);
  }
  return refs;
}

/**
 * How each field of a nested option is read: the field's value when it is of the right kind, else `undefined`.
 *
 * @template {object} Section
 * @typedef {{ [Key in keyof Section]-?: (value: unknown) => Section[Key] | undefined }} Schema
 */

/**
 * @template T
 * @param {(value: unknown) => value is T} check
 * @returns {(value: unknown) => T | undefined}
 */
const when = (check) => (value) => (check(value) ? value : undefined);

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const isHostname = (value) => isText(value) && HOSTNAME.test(value);

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const isCookieName = (value) => isText(value) && COOKIE_NAME.test(value);

/**
 * @param {unknown} value
 * @returns {value is boolean | string} `true` for `window.dataLayer`, or the name of another global array.
 */
const isDataLayer = (value) => typeof value === 'boolean' || (isText(value) && GLOBAL_NAME.test(value));

const url = when(isSiteOrHttpsUrl);
const text = when(isText);
const flag = when((value) => typeof value === 'boolean');
const hook = when(isFunction);

/**
 * @template {object} Section
 * @param {string} name
 * @param {unknown} value
 * @param {Schema<Section>} schema
 * @param {Invalid} invalid
 * @returns {Section | null} The fields of the right kind; each other one is dropped with a warning.
 */
function sectionOption(name, value, schema, invalid) {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    invalid(name, value);
    return null;
  }
  /** @type {Record<string, unknown>} */
  const section = {};
  /** @type {Readonly<Record<string, (value: unknown) => unknown>>} */
  const readers = schema;
  for (const [key, read] of Object.entries(readers)) {
    const field = value[key];
    if (field === undefined) continue;
    const parsed = read(field);
    if (parsed === undefined) invalid(`${name}.${key}`, field);
    else section[key] = parsed;
  }
  // Each field went through the reader its schema entry gives it, which returns that field's type in `Section`.
  return /** @type {Section} */ (section);
}

/** @type {Schema<Partial<AccountConfig>>} */
const ACCOUNT = {
  server: url,
  orderUrl: url,
  subscriptionsUrl: url,
  paymentUrl: url,
  logoutUrl: url,
  locale: text,
  navigate: hook,
};

/** Customer tokens are never kept in the browser, so an `account` without the Worker is off. */
const ACCOUNT_NEEDS_SERVER = 'customer accounts need the Worker since 0.7.0: set account.server';

/** @type {Schema<LocaleMarket>} */
const LOCALE_MARKET = { country: text, language: text, locale: text };

/** @type {Schema<MarketsConfig>} */
const MARKETS = {
  // A single source name counts as a list of one.
  detect: (value) => {
    if (typeof value === 'boolean') return value;
    const names = Array.isArray(value) ? /** @type {unknown[]} */ (value) : [value];
    return typeof value === 'string' || Array.isArray(value)
      ? MARKET_SOURCES.filter((source) => names.includes(source))
      : undefined;
  },
  locales: (value) => {
    if (!isRecord(value)) return undefined;
    /** @type {Record<string, LocaleMarket>} */
    const locales = {};
    for (const [locale, entry] of Object.entries(value)) {
      const market = sectionOption(`markets.locales.${locale}`, entry, LOCALE_MARKET, () => undefined);
      if (market) locales[locale] = market;
    }
    return locales;
  },
  cookie: when(isCookieName),
  remember: flag,
  strict: flag,
};

/**
 * `proxy` says the site serves the Storefront API on its own domain. Shopify's script only needs to know that it
 * does, not where, so any truthy value (including a path such as `'/api'`) turns it on.
 *
 * @type {Schema<ShopifyAnalyticsOptions>}
 */
const SHOPIFY_ANALYTICS = {
  consent: (value) => CONSENT_MODES.find((mode) => mode === value),
  proxy: (value) => value !== undefined && Boolean(value),
};

/** @type {Schema<AnalyticsConfig>} */
const ANALYTICS = {
  dataLayer: when(isDataLayer),
  shopify: (value) =>
    typeof value === 'boolean'
      ? value
      : (sectionOption('analytics.shopify', value, SHOPIFY_ANALYTICS, () => undefined) ?? undefined),
  onEvent: hook,
};

/**
 * @param {unknown} value
 * @param {Invalid} invalid
 * @param {(message: string) => void} warn Says why an `account` without a usable `server` is off.
 * @returns {AccountConfig | null} `null` without a usable `account.server`: nothing of the account part loads.
 */
export function accountOption(value, invalid, warn) {
  const account = sectionOption('account', value, ACCOUNT, invalid);
  if (account === null) return null;
  const { server } = account;
  if (server === undefined) {
    warn(ACCOUNT_NEEDS_SERVER);
    return null;
  }
  return { ...account, server };
}

/**
 * @param {unknown} value
 * @param {Invalid} invalid
 * @returns {MarketsConfig | null}
 */
export const marketsOption = (value, invalid) => sectionOption('markets', value, MARKETS, invalid);

/**
 * @param {unknown} value
 * @param {Invalid} invalid
 * @returns {AnalyticsConfig | null}
 */
export const analyticsOption = (value, invalid) => sectionOption('analytics', value, ANALYTICS, invalid);
