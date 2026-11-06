/**
 * The setup check's first half: which settings are present and well-formed. No network, so it runs for anyone who
 * opens /check, and its result says whether the connection tests have what they need.
 */
import { accountProblems, accountSettings } from '../account/settings.ts';
import { envProblems, kvBinding, MIN_SECRET_LENGTH } from '../env.ts';
import { deployHookMinSeconds } from '../settings.ts';
import type { Steps } from './steps.ts';
import type { CleanEnv } from '../env.ts';
import type { SyncConfig } from '../mapping.ts';

/** Where product changes go: a Webflow collection, or only a deploy hook (a statically built site). */
type SyncTarget = { kind: 'deploy-hook' } | { kind: 'webflow'; token: string; collectionId: string };

/** What the connection tests need. `null` from {@link checkSettings} when a setting they use is missing. */
export interface ConnectionSettings {
  /** The store's `.myshopify.com` domain. */
  domain: string;
  target: SyncTarget;
}

interface SettingsContext {
  config: SyncConfig;
  env: CleanEnv;
  /** The env as it arrived, to tell "not set" from "set but ignored". */
  rawEnv: Record<string, unknown>;
  /** Running as the Worker (not the CLI): accounts and SYNC_SECRET apply. */
  worker: boolean;
  /** The Worker's own webhook URL, when it knows it. */
  webhookUri: string | null;
}

const QUARTERLY_API_VERSION = /^\d{4}-(01|04|07|10)$/;
const MYSHOPIFY_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const WEBFLOW_ID = /^[a-f0-9]{24}$/i;

/** Filled-in values that are ignored: said first, or "missing" further down would be confusing. */
export function reportIgnoredValues(steps: Steps, rawEnv: Record<string, unknown>): void {
  for (const { key, reason } of envProblems(rawEnv)) {
    if (reason === 'placeholder')
      steps.add(
        'error',
        key,
        'still has an example value, so it counts as not set.',
        `Replace it with the real value (or leave it empty if you don't use it).`,
      );
    else
      steps.add(
        'error',
        key,
        `is shorter than ${String(MIN_SECRET_LENGTH)} characters, so it counts as not set.`,
        `Use a random string of at least ${String(MIN_SECRET_LENGTH)} characters, e.g. from a password manager.`,
      );
  }
}

/**
 * @returns The store domain, when it and the credentials are usable.
 */
function checkShopifySettings(steps: Steps, config: SyncConfig, env: CleanEnv): string | null {
  const { apiVersion, domain } = config.shopify;
  if (!QUARTERLY_API_VERSION.test(apiVersion)) {
    steps.add(
      'error',
      'Shopify API version',
      `"${apiVersion}" isn't a dated quarterly version.`,
      'Pin a version like 2026-07 (never "unstable": it changes without notice).',
    );
  }
  const domainOk = Boolean(domain && MYSHOPIFY_DOMAIN.test(domain));
  if (!domain)
    steps.add(
      'error',
      'Shopify store',
      'No store domain.',
      'Set SHOPIFY_DOMAIN to your-store.myshopify.com (not your custom domain).',
    );
  else if (!domainOk)
    steps.add(
      'error',
      'Shopify store',
      `"${domain}" isn't a .myshopify.com domain.`,
      'Use the your-store.myshopify.com domain from Shopify admin → Settings → Domains.',
    );
  else steps.add('ok', 'Shopify store', domain);

  const hasClientCredentials = Boolean(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET);
  if (env.SHOPIFY_ADMIN_TOKEN) steps.add('ok', 'Shopify access', 'using admin token');
  else if (hasClientCredentials) steps.add('ok', 'Shopify access', 'using client credentials');
  else
    steps.add(
      'error',
      'Shopify access',
      env.SHOPIFY_CLIENT_ID || env.SHOPIFY_CLIENT_SECRET
        ? 'Only one of SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET is set.'
        : 'No Shopify credentials.',
      'Create an app in the Shopify Dev Dashboard with the read_products scope, install it on the store, and set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN for an existing custom app).',
    );
  const hasCredentials = Boolean(env.SHOPIFY_ADMIN_TOKEN) || hasClientCredentials;
  return domain && domainOk && hasCredentials ? domain : null;
}

/** Browsers only send the account cookie to the Worker when it runs on the site's own domain or a subdomain of it. */
function servesSiteDomain(origins: string[], workerHost: string): boolean {
  return origins
    .filter((origin) => URL.canParse(origin))
    .some((origin) => {
      const siteHost = new URL(origin).hostname;
      return siteHost === workerHost || workerHost.endsWith(`.${siteHost.replace(/^www\./, '')}`);
    });
}

/** Customer accounts through this Worker. */
function checkAccounts(steps: Steps, { rawEnv, worker, webhookUri }: SettingsContext): void {
  const settings = accountSettings(rawEnv);
  if (!settings) return;
  const problems = accountProblems(settings);
  for (const problem of problems)
    steps.add(problem.severity === 'warning' ? 'warn' : 'error', 'Customer accounts', problem.message, problem.fix);
  // The Worker refuses account requests without the namespace (account.ts); elsewhere the host passes its own store.
  const unbound = worker && !kvBinding(rawEnv);
  if (unbound) {
    steps.add(
      'error',
      'Customer accounts',
      'The TETHER_SYNC KV namespace is not bound, so no login can be kept: accounts answer 503.',
      'Cloudflare → your Worker → Bindings → add the KV namespace as TETHER_SYNC, as in wrangler.jsonc.',
    );
  }
  if (!problems.length && !unbound) {
    const client = settings.clientSecret ? ' (confidential client)' : '';
    steps.add('ok', 'Customer accounts', `on for ${settings.origins.join(', ')}${client}`);
  }
  const [home] = settings.origins;
  if (!worker || !webhookUri || !home || !URL.canParse(home)) return;
  const workerOrigin = new URL(webhookUri).origin;
  const workerHost = new URL(webhookUri).hostname;
  if (servesSiteDomain(settings.origins, workerHost)) {
    steps.add(
      'ok',
      'Customer accounts callback',
      `register ${workerOrigin}/_tether/account/callback (callback), ${home} (JavaScript origin) and ${home}/ (logout) in Shopify → Headless → Customer Account API`,
    );
    return;
  }
  const siteDomain = new URL(home).hostname.replace(/^www\./, '');
  steps.add(
    'error',
    'Customer accounts',
    `this Worker runs on ${workerHost}, not on your site's domain, so browsers won't send its login cookie.`,
    `Cloudflare → Workers → tether-sync → Settings → Domains & Routes → add the route ${home.replace(/^https:\/\//, '')}/_tether/* (or a custom domain like account.${siteDomain}). Then register ${home}/_tether/account/callback as callback URI in Shopify.`,
  );
}

/**
 * The deploy hook, the Webflow token and the collection.
 *
 * @returns `null` when Webflow is the target but its token or collection is missing.
 */
function checkTarget(steps: Steps, config: SyncConfig, env: CleanEnv): SyncTarget | null {
  const hookUrl = env.DEPLOY_HOOK_URL;
  const webflowToken = env.WEBFLOW_TOKEN;
  if (hookUrl && !hookUrl.startsWith('https://'))
    steps.add(
      'error',
      'Deploy hook',
      'DEPLOY_HOOK_URL must be an https URL.',
      'Copy the deploy hook URL from Cloudflare Pages (Settings → Builds → Deploy hooks), Netlify (Build hooks) or Vercel (Deploy Hooks).',
    );
  else if (hookUrl) {
    const besides = webflowToken ? 'next to Webflow' : 'no Webflow';
    steps.add(
      'ok',
      'Deploy hook',
      `set: a product change starts a build (at most every ${String(deployHookMinSeconds(env))}s), ${besides}`,
    );
  }
  if (hookUrl && !webflowToken) return { kind: 'deploy-hook' };

  if (webflowToken) steps.add('ok', 'Webflow token', 'set');
  else
    steps.add(
      'error',
      'Webflow token',
      'WEBFLOW_TOKEN is missing.',
      'Webflow → Site settings → Apps & integrations → API access → generate a token with CMS read and write. (Static site instead? Set DEPLOY_HOOK_URL.)',
    );

  const { collectionId } = config.webflow;
  if (!collectionId)
    steps.add(
      'error',
      'Webflow collection',
      'No collection id.',
      'Set WEBFLOW_COLLECTION_ID (Webflow CMS → collection settings, or GET /v2/sites/{site_id}/collections).',
    );
  else if (WEBFLOW_ID.test(collectionId)) steps.add('ok', 'Webflow collection', collectionId);
  else
    steps.add(
      'warn',
      'Webflow collection',
      `"${collectionId}" doesn't look like a Webflow id (24 hex characters).`,
      'Copy the collection id, not its name or slug.',
    );
  return webflowToken && collectionId ? { kind: 'webflow', token: webflowToken, collectionId } : null;
}

function checkSecrets(steps: Steps, { env, rawEnv, worker }: SettingsContext): void {
  if (env.SHOPIFY_WEBHOOK_SECRET) steps.add('ok', 'Webhooks', 'SHOPIFY_WEBHOOK_SECRET set');
  else if (env.SHOPIFY_CLIENT_SECRET) steps.add('ok', 'Webhooks', 'verified with the app client secret');
  else
    steps.add(
      'warn',
      'Webhooks',
      'No webhook secret: webhooks will be rejected, only the cron reconcile syncs.',
      'Set SHOPIFY_WEBHOOK_SECRET (Settings → Notifications → Webhooks shows it), or use a Dev Dashboard app (its client secret is used).',
    );

  if (worker && !kvBinding(rawEnv)) {
    steps.add(
      'warn',
      'KV storage',
      'TETHER_SYNC is not bound: the sync keeps nothing between runs, so POST /reconcile and the cron refuse to run, and every webhook rewrites its product.',
      'Cloudflare → your Worker → Bindings → add the KV namespace as TETHER_SYNC, as in wrangler.jsonc.',
    );
  }

  // A SYNC_SECRET that is set but ignored was already reported.
  const syncSecretIgnored = envProblems(rawEnv).some((problem) => problem.key === 'SYNC_SECRET');
  if (worker && !env.SYNC_SECRET && !syncSecretIgnored) {
    steps.add(
      'warn',
      'SYNC_SECRET',
      'not set: /check can only show what is configured, and POST /reconcile is off.',
      `Set a random string of at least ${String(MIN_SECRET_LENGTH)} characters to test the APIs from /check.`,
    );
  }
}

/**
 * Checks every setting, adding one step per finding.
 *
 * @returns `null` when the connection tests cannot run yet.
 */
export function checkSettings(steps: Steps, context: SettingsContext): ConnectionSettings | null {
  const { config, env } = context;
  const domain = checkShopifySettings(steps, config, env);
  checkAccounts(steps, context);
  const target = checkTarget(steps, config, env);
  checkSecrets(steps, context);
  return domain && target ? { domain, target } : null;
}
