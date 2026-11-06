/** The customer-account settings of the Worker, read once from its env. */

import { STOREFRONT_API_VERSION } from '../shared/api-versions.ts';
import { cleanEnv, MIN_SYNC_SECRET } from '../env.ts';

/** What the requests to Shopify need. */
export interface ShopifyAccountSettings {
  /** Customer Account API client id (Headless channel). */
  clientId: string;
  /** Only for a confidential client; `''` for a public one. */
  clientSecret: string;
  /** The store's domain, as a bare host name. */
  shopDomain: string;
  /** The public Storefront token, used to link carts; `''` when not set. */
  storefrontToken: string;
  /** Storefront API version for cart links. */
  apiVersion: string;
}

/** How long a login lasts. `replaced`: ACCOUNT_SESSION_DAYS was set to something unusable, and `days` is used instead. */
type SessionDays =
  | { kind: 'as-set'; days: number }
  | { kind: 'replaced'; days: number; raw: string; reason: 'not a whole number' | 'outside 1 to 90' };

export interface AccountSettings extends ShopifyAccountSettings {
  /** The site's https origins, without a trailing slash, the first being the site's home. */
  origins: string[];
  /**
   * ACCOUNT_SECRET, the root of every sealing key, kept apart from SYNC_SECRET (the password for /reconcile and
   * /check) so that password can't open customer sessions; `null` when it isn't set.
   */
  secret: string | null;
  sessionDays: SessionDays;
}

/** Settings {@link accountProblems} finds no error in, flattened to what the routes use. */
export interface ReadyAccountSettings extends ShopifyAccountSettings {
  origins: [string, ...string[]];
  secret: string;
  sessionDays: number;
}

export interface AccountProblem {
  severity: 'error' | 'warning';
  message: string;
  fix?: string;
}

const DEFAULT_SESSION_DAYS = 14;
const MAX_SESSION_DAYS = 90;
const WHOLE_NUMBER = /^\d+$/;
/** A DNS host name: dot-separated labels of letters, digits and inner hyphens. */
const HOST_NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * @param raw ACCOUNT_SESSION_DAYS.
 */
function sessionDaysOf(raw: string | undefined): SessionDays {
  if (raw === undefined) return { kind: 'as-set', days: DEFAULT_SESSION_DAYS };
  if (!WHOLE_NUMBER.test(raw)) {
    return { kind: 'replaced', days: DEFAULT_SESSION_DAYS, raw, reason: 'not a whole number' };
  }
  const days = Number(raw);
  if (days >= 1 && days <= MAX_SESSION_DAYS) return { kind: 'as-set', days };
  return { kind: 'replaced', days: Math.max(1, Math.min(MAX_SESSION_DAYS, days)), raw, reason: 'outside 1 to 90' };
}

/**
 * @returns `null` when accounts are off (no ACCOUNT_CLIENT_ID).
 */
export function accountSettings(rawEnv: Record<string, unknown>): AccountSettings | null {
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
    secret: env.ACCOUNT_SECRET ?? null,
    sessionDays: sessionDaysOf(env.ACCOUNT_SESSION_DAYS),
    apiVersion: env.STOREFRONT_API_VERSION ?? STOREFRONT_API_VERSION,
  };
}

/** The problems of the settings that are not about the secret. */
function siteAndShopProblems(
  settings: AccountSettings,
  error: (message: string) => void,
  warning: (message: string) => void,
): void {
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

/** What stops accounts from working (`error`) or weakens them (`warning`). Empty when all is set. */
export function accountProblems(settings: AccountSettings): AccountProblem[] {
  const problems: AccountProblem[] = [];
  const error = (message: string) => problems.push({ severity: 'error', message });
  const warning = (message: string) => problems.push({ severity: 'warning', message });
  siteAndShopProblems(settings, error, warning);
  if (settings.secret === null) {
    problems.push({
      severity: 'error',
      message: 'ACCOUNT_SECRET is not set: customer sessions are encrypted with it, so accounts answer 503.',
      fix:
        `Add the Worker secret ACCOUNT_SECRET, a random string of at least ${String(MIN_SYNC_SECRET)} characters ` +
        '(e.g. `openssl rand -hex 24`), different from SYNC_SECRET. Changing it later logs every customer out once.',
    });
  }
  return problems;
}

/** The settings once nothing stops accounts from working, or the errors that do. */
export function readyAccountSettings(
  settings: AccountSettings,
): { kind: 'ready'; settings: ReadyAccountSettings } | { kind: 'not-ready'; errors: AccountProblem[] } {
  const errors = accountProblems(settings).filter((problem) => problem.severity === 'error');
  const { origins, secret, sessionDays } = settings;
  const [home, ...others] = origins;
  // accountProblems reports each of these as an error, so they are only missing alongside one.
  if (errors.length || home === undefined || secret === null) return { kind: 'not-ready', errors };
  return {
    kind: 'ready',
    settings: { ...settings, origins: [home, ...others], secret, sessionDays: sessionDays.days },
  };
}
