/**
 * The Worker's settings as they arrive: Cloudflare vars and secrets, or `.dev.vars` / `process.env` for the CLI. Every
 * module reads them through `cleanEnv`, so "not set" means the same everywhere.
 */
import type { KvListPage } from './store.ts';

type EnvName =
  | 'SHOPIFY_DOMAIN'
  | 'SHOPIFY_API_VERSION'
  | 'SHOPIFY_ADMIN_TOKEN'
  | 'SHOPIFY_CLIENT_ID'
  | 'SHOPIFY_CLIENT_SECRET'
  | 'SHOPIFY_WEBHOOK_SECRET'
  | 'WEBFLOW_TOKEN'
  | 'WEBFLOW_COLLECTION_ID'
  | 'WEBFLOW_OWNED'
  | 'FIELD_MAP'
  | 'SYNC_SECRET'
  | 'DEPLOY_HOOK_URL'
  | 'DEPLOY_HOOK_MIN_SECONDS'
  | 'MAX_SUBREQUESTS'
  | 'TETHER_VERSION'
  | 'ACCOUNT_CLIENT_ID'
  | 'ACCOUNT_CLIENT_SECRET'
  | 'ACCOUNT_ORIGINS'
  | 'ACCOUNT_SECRET'
  | 'ACCOUNT_SESSION_DAYS'
  | 'STOREFRONT_TOKEN'
  | 'STOREFRONT_API_VERSION'
  | 'HOST'
  | 'PORT';

/** The usable string settings, trimmed. */
export type CleanEnv = Readonly<Partial<Record<EnvName, string>>>;
interface EnvProblem {
  key: string;
  reason: 'placeholder' | 'too-short';
}

const UNSET = new Set(['none', '-', 'null', 'undefined']);
/**
 * Example values from Tether's docs and from the example vars file of earlier releases, exactly as written there. Only
 * an exact match is a placeholder, so a real value that resembles one (a field named `todo-notes`, a mapping with an
 * ellipsis) is still used.
 */
const PLACEHOLDERS = new Set([
  'your-store.myshopify.com',
  'your-collection-id',
  'your-webflow-site-token',
  'your-app-client-id',
  'your-app-client-secret',
  'your-public-storefront-token',
  'choose-a-long-random-string',
  'shpat_…',
]);

/** Shortest SYNC_SECRET or ACCOUNT_SECRET accepted; a shorter one counts as unset. */
export const MIN_SECRET_LENGTH = 24;
const SECRETS = new Set(['SYNC_SECRET', 'ACCOUNT_SECRET']);

/**
 * Why a filled-in value is ignored, or `null` when it is usable or simply empty.
 *
 * @param value Trimmed.
 */
function valueProblem(key: string, value: string): EnvProblem['reason'] | null {
  if (PLACEHOLDERS.has(value)) return 'placeholder';
  if (SECRETS.has(key) && value.length < MIN_SECRET_LENGTH) return 'too-short';
  return null;
}

function filledIn(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return UNSET.has(trimmed.toLowerCase()) ? '' : trimmed;
}

/** Values that were filled in but are ignored, for `/check`. */
export function envProblems(env: Record<string, unknown>): EnvProblem[] {
  const problems: EnvProblem[] = [];
  for (const [key, raw] of Object.entries(env)) {
    const value = filledIn(raw);
    const reason = value ? valueProblem(key, value) : null;
    if (reason) problems.push({ key, reason });
  }
  return problems;
}

/**
 * The string settings that count as set. Empty values, `none` / `-`, example placeholders and a secret shorter than
 * {@link MIN_SECRET_LENGTH} characters are left out. Bindings (KV namespaces) are not strings and are left out too.
 */
export function cleanEnv(env: Record<string, unknown>): CleanEnv {
  const clean: Record<string, string> = {};
  for (const [key, raw] of Object.entries(env)) {
    const value = filledIn(raw);
    if (value && !valueProblem(key, value)) clean[key] = value;
  }
  return clean;
}

/**
 * The Worker's KV namespace binding, as far as Tether uses it. Cloudflare defines the signatures; only that the four
 * methods exist can be checked when the binding arrives.
 */
export interface KvBinding {
  get(key: string, type?: 'text' | 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; limit: number }): Promise<KvListPage>;
}

/** The binding's name in wrangler.jsonc. */
const KV_BINDING = 'TETHER_SYNC';

function isKvBinding(value: unknown): value is KvBinding {
  if (value === null || typeof value !== 'object') return false;
  return ['get', 'put', 'delete', 'list'].every((method) => typeof Reflect.get(value, method) === 'function');
}

/** The TETHER_SYNC KV namespace, or `null` when the Worker has none, or a setting by that name that is no namespace. */
export function kvBinding(env: Record<string, unknown>): KvBinding | null {
  const binding = env[KV_BINDING];
  return isKvBinding(binding) ? binding : null;
}
