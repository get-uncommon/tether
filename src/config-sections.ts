/**
 * Parsers for the options with structure, whose values become URLs, credentials, storage names or query text: the
 * store's domain, the metafields, the embed origins and the nested `account`, `markets` and `analytics` objects.
 * `account.server` becomes the base of credentialed requests, so a value of the wrong kind is dropped (with a warning
 * through `invalid`), never used. `config.ts` resolves the rest.
 */
import { isRecord } from '../server/src/shared/json.ts';
import { isMetafieldIdentifier, metafieldIdentifierOf } from '../server/src/shared/metafield-ref.ts';
import type { AccountConfig, AnalyticsConfig, MarketsConfig, MetafieldIdentifier, MetafieldRef } from './config.ts';

/** Warns that an option was dropped. */
type Invalid = (name: string, value: unknown) => void;

/** A host name, without protocol or path: what `domainOption` keeps of the `domain` option. */
export type ShopDomain = string & { readonly __brand: 'ShopDomain' };
type LocaleMarket = NonNullable<MarketsConfig['locales']>[string];
type ShopifyAnalyticsOptions = Exclude<NonNullable<AnalyticsConfig['shopify']>, boolean>;

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
/** Every source `markets.detect` reads. */
export const MARKET_SOURCES: readonly ('saved' | 'server' | 'webflow')[] = ['saved', 'server', 'webflow'];
const CONSENT_MODES: readonly NonNullable<ShopifyAnalyticsOptions['consent']>[] = [
  'no-banner',
  'default-banner',
  'custom-banner',
];

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** A hook the site passes. What it is called with is up to Tether, and what it returns is not used. */
const isFunction = (value: unknown): value is (...args: unknown[]) => unknown => typeof value === 'function';

/**
 * @returns The store's domain without protocol or path (`https://shop.example/x` → `shop.example`), `''` for anything
 *   that isn't a host name.
 */
export function domainOption(value: unknown, invalid: Invalid): ShopDomain | '' {
  if (typeof value !== 'string' || !value) return '';
  const host = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (isHostname(host)) return host;
  invalid('domain', value);
  return '';
}

/** @returns True for a path on this site, an https URL, or an http one on the developer's machine. */
function isSiteOrHttpsUrl(value: unknown): value is string {
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
 * @returns The folder as written, `null` for none or one elsewhere (the parts then load beside the core).
 */
export function partsUrlOption(value: unknown, invalid: Invalid): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && (isSiteOrHttpsUrl(value) || isPageOrigin(value))) return value;
  invalid('partsUrl', value);
  return null;
}

/** @returns True for an absolute URL on the page's own origin (a site served over plain http). */
function isPageOrigin(value: string): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URL(value).origin === location.origin;
  } catch {
    // Not an absolute URL: `isSiteOrHttpsUrl` has judged it.
    return false;
  }
}

/** @returns An https origin written as just that (`https://video.example`), `null` for anything else. */
function toHttpsOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.href === new URL(url.origin).href ? url.origin : null;
  } catch {
    // Not an absolute URL.
    return null;
  }
}

/**
 * The origins a site lets description iframes load from. Each one is trusted to show only what the site expects in a
 * description, so only a bare https origin is taken: a path would suggest a narrower trust than is given.
 *
 * @returns The valid origins; each other entry is skipped with a warning.
 */
export function embedOriginsOption(value: unknown, invalid: Invalid): string[] {
  if (!Array.isArray(value)) {
    invalid('embedOrigins', value);
    return [];
  }
  const origins: string[] = [];
  const entries: unknown[] = value;
  for (const entry of entries) {
    const origin = toHttpsOrigin(entry);
    if (origin) origins.push(origin);
    else invalid('embedOrigin', entry);
  }
  return origins;
}

/** @returns The identifier of `'namespace.key'` or `{ namespace, key }`, when both parts are valid identifiers. */
export function toMetafieldIdentifier(ref: unknown): MetafieldIdentifier | null {
  if (typeof ref === 'string') return metafieldIdentifierOf(ref);
  if (typeof ref !== 'object' || ref === null) return null;
  const namespace: unknown = Reflect.get(ref, 'namespace');
  const key: unknown = Reflect.get(ref, 'key');
  if (typeof namespace !== 'string' || typeof key !== 'string') return null;
  return isMetafieldIdentifier(namespace, key) ? { namespace, key } : null;
}

/** @returns The refs that name a valid identifier, as written; each other one is skipped with a warning. */
export function metafieldsOption(value: unknown, invalid: Invalid): MetafieldRef[] {
  if (!Array.isArray(value)) {
    invalid('metafields', value);
    return [];
  }
  const refs: MetafieldRef[] = [];
  const entries: unknown[] = value;
  for (const ref of entries) {
    const identifier = toMetafieldIdentifier(ref);
    if (identifier) refs.push(typeof ref === 'string' ? ref : identifier);
    else invalid('metafield', ref);
  }
  return refs;
}

/** How each field of a nested option is read: the field's value when it is of the right kind, else `undefined`. */
type Schema<Section extends object> = { [Key in keyof Section]-?: (value: unknown) => Section[Key] | undefined };

const when =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): T | undefined =>
    check(value) ? value : undefined;

/** The pattern is what makes a string a `ShopDomain`. */
const isHostname = (value: unknown): value is ShopDomain => isText(value) && HOSTNAME.test(value);

const isCookieName = (value: unknown): value is string => isText(value) && COOKIE_NAME.test(value);

/** `true` for `window.dataLayer`, or the name of another global array. */
const isDataLayer = (value: unknown): value is boolean | string =>
  typeof value === 'boolean' || (isText(value) && GLOBAL_NAME.test(value));

const url = when(isSiteOrHttpsUrl);
const text = when(isText);
const flag = when((value): value is boolean => typeof value === 'boolean');
const hook = when(isFunction);

/** @returns The fields of the right kind; each other one is dropped with a warning. */
function sectionOption<Section extends object>(
  name: string,
  value: unknown,
  schema: Schema<Section>,
  invalid: Invalid,
): Partial<Section> | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    invalid(name, value);
    return null;
  }
  const section: Partial<Section> = {};
  for (const key in schema) {
    const field = value[key];
    if (field === undefined) continue;
    const parsed = schema[key](field);
    if (parsed === undefined) invalid(`${name}.${key}`, field);
    else section[key] = parsed;
  }
  return section;
}

export const ACCOUNT: Schema<Partial<AccountConfig>> = {
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

const LOCALE_MARKET: Schema<LocaleMarket> = { country: text, language: text, locale: text };

export const MARKETS: Schema<MarketsConfig> = {
  // A single source name counts as a list of one.
  detect: (value) => {
    if (typeof value === 'boolean') return value;
    const names: unknown[] = Array.isArray(value) ? value : [value];
    return typeof value === 'string' || Array.isArray(value)
      ? MARKET_SOURCES.filter((source) => names.includes(source))
      : undefined;
  },
  locales: (value) => {
    if (!isRecord(value)) return undefined;
    const locales: Record<string, LocaleMarket> = {};
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
 */
const SHOPIFY_ANALYTICS: Schema<ShopifyAnalyticsOptions> = {
  consent: (value) => CONSENT_MODES.find((mode) => mode === value),
  proxy: (value) => value !== undefined && Boolean(value),
};

export const ANALYTICS: Schema<AnalyticsConfig> = {
  dataLayer: when(isDataLayer),
  shopify: (value) =>
    typeof value === 'boolean'
      ? value
      : (sectionOption('analytics.shopify', value, SHOPIFY_ANALYTICS, () => undefined) ?? undefined),
  onEvent: hook,
};

/**
 * @param warn Says why an `account` without a usable `server` is off.
 * @returns `null` without a usable `account.server`: nothing of the account part loads.
 */
export function accountOption(value: unknown, invalid: Invalid, warn: (message: string) => void): AccountConfig | null {
  const account = sectionOption('account', value, ACCOUNT, invalid);
  if (account === null) return null;
  const { server } = account;
  if (server === undefined) {
    warn(ACCOUNT_NEEDS_SERVER);
    return null;
  }
  return { ...account, server };
}

export const marketsOption = (value: unknown, invalid: Invalid): MarketsConfig | null =>
  sectionOption('markets', value, MARKETS, invalid);

export const analyticsOption = (value: unknown, invalid: Invalid): AnalyticsConfig | null =>
  sectionOption('analytics', value, ANALYTICS, invalid);
