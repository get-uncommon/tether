/**
 * The Worker's settings as they arrive: Cloudflare vars and secrets, or `.dev.vars` / `process.env` for the CLI. Every
 * module reads them through `cleanEnv`, so "not set" means the same everywhere.
 */

/**
 * @typedef {'SHOPIFY_DOMAIN' | 'SHOPIFY_API_VERSION' | 'SHOPIFY_ADMIN_TOKEN' | 'SHOPIFY_CLIENT_ID'
 *   | 'SHOPIFY_CLIENT_SECRET' | 'SHOPIFY_WEBHOOK_SECRET' | 'WEBFLOW_TOKEN' | 'WEBFLOW_COLLECTION_ID' | 'WEBFLOW_OWNED'
 *   | 'FIELD_MAP' | 'SYNC_SECRET' | 'DEPLOY_HOOK_URL' | 'DEPLOY_HOOK_MIN_SECONDS' | 'MAX_SUBREQUESTS' | 'TETHER_VERSION'
 *   | 'ACCOUNT_CLIENT_ID' | 'ACCOUNT_CLIENT_SECRET' | 'ACCOUNT_ORIGINS' | 'ACCOUNT_SECRET' | 'ACCOUNT_SESSION_DAYS'
 *   | 'STOREFRONT_TOKEN' | 'STOREFRONT_API_VERSION' | 'HOST' | 'PORT'} EnvName
 */

/** @typedef {Readonly<Partial<Record<EnvName, string>>>} CleanEnv The usable string settings, trimmed. */
/** @typedef {{ key: string, reason: 'placeholder' | 'too-short' }} EnvProblem */

const UNSET = new Set(['none', '-', 'null', 'undefined']);
/** Example values from the docs and the example vars file: never real credentials. */
const PLACEHOLDER = /^(your[-_]|choose[-_]|example|changeme|change[-_]me|placeholder|xxx+|todo|<.*>$)|\.\.\.|…/i;

/** Shortest SYNC_SECRET or ACCOUNT_SECRET accepted; a shorter one counts as unset. */
export const MIN_SYNC_SECRET = 24;
const SECRETS = new Set(['SYNC_SECRET', 'ACCOUNT_SECRET']);

/**
 * Why a filled-in value is ignored, or `null` when it is usable or simply empty.
 *
 * @param {string} key
 * @param {string} value Trimmed.
 * @returns {EnvProblem['reason'] | null}
 */
function valueProblem(key, value) {
  if (PLACEHOLDER.test(value)) return 'placeholder';
  if (SECRETS.has(key) && value.length < MIN_SYNC_SECRET) return 'too-short';
  return null;
}

/** @param {unknown} value */
function filledIn(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return UNSET.has(trimmed.toLowerCase()) ? '' : trimmed;
}

/**
 * Values that were filled in but are ignored, for `/check`.
 *
 * @param {Record<string, unknown>} env
 * @returns {EnvProblem[]}
 */
export function envProblems(env) {
  /** @type {EnvProblem[]} */
  const problems = [];
  for (const [key, raw] of Object.entries(env)) {
    const value = filledIn(raw);
    const reason = value ? valueProblem(key, value) : null;
    if (reason) problems.push({ key, reason });
  }
  return problems;
}

/**
 * The string settings that count as set. Empty values, `none` / `-`, example placeholders and a secret shorter than
 * {@link MIN_SYNC_SECRET} characters are left out. Bindings (KV namespaces) are not strings and are left out too.
 *
 * @param {Record<string, unknown>} env
 * @returns {CleanEnv}
 */
export function cleanEnv(env) {
  /** @type {Record<string, string>} */
  const clean = {};
  for (const [key, raw] of Object.entries(env)) {
    const value = filledIn(raw);
    if (value && !valueProblem(key, value)) clean[key] = value;
  }
  return clean;
}

/**
 * The Worker's KV namespace binding, as far as Tether uses it. Cloudflare defines the signatures; only that the three
 * methods exist can be checked when the binding arrives.
 *
 * @typedef {object} KvBinding
 * @property {(key: string, type?: 'text' | 'json') => Promise<unknown>} get
 * @property {(key: string, value: string, options?: { expirationTtl: number }) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 */

/** The binding's name in wrangler.jsonc. */
const KV_BINDING = 'TETHER_SYNC';

/**
 * @param {unknown} value
 * @returns {value is KvBinding}
 */
function isKvBinding(value) {
  if (value === null || typeof value !== 'object') return false;
  return ['get', 'put', 'delete'].every((method) => typeof Reflect.get(value, method) === 'function');
}

/**
 * The TETHER_SYNC KV namespace, or `null` when the Worker has none, or a setting by that name that is no namespace.
 *
 * @param {Record<string, unknown>} env
 * @returns {KvBinding | null}
 */
export function kvBinding(env) {
  const binding = env[KV_BINDING];
  return isKvBinding(binding) ? binding : null;
}
