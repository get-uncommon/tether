/**
 * The one Storefront API client: a fetch wrapper that adds the market (`@inContext`), retries what Shopify asks to be
 * retried, and turns every failure into a `TetherError`. The browser (`gql`, also `Tether.query()`) and the server
 * helpers (`request` with their own config) share it.
 */
import { cfg, log } from './config.js';
import { toCountry, toLanguage } from './market-codes.js';
import { field, isRecord } from '../server/src/shared/json.js';
/** @import { TetherConfig } from './config.js' */
/** @import { CountryCode, LanguageCode } from './market-codes.js' */

/**
 * @typedef {'NOT_FOUND' | 'NETWORK' | 'NOT_CONFIGURED' | 'NOT_LOGGED_IN' | 'NOT_ALLOWED' | 'INVALID'
 *   | 'INVALID_COUNTRY' | 'INVALID_DISCOUNT' | 'SESSION_ENDED' | 'TOKEN_FAILED' | 'ERROR' | `HTTP_${number}`}
 *   TetherErrorCode
 */
/** @typedef {{ message: string, extensions?: { code?: string } }} GraphQLError */
/** @typedef {{ data?: unknown, errors?: GraphQLError[] }} GraphQLResponse The response shape the GraphQL spec sets. */
/** @typedef {{ message: string, field?: string[] | null, code?: string | null }} UserError */
/**
 * @typedef {object} TetherErrorDetails
 * @property {TetherErrorCode} [code] Default `HTTP_<status>` with a status, else `ERROR`.
 * @property {number} [status] The HTTP status of the response that failed.
 * @property {GraphQLError[]} [errors] The GraphQL errors of that response.
 * @property {readonly UserError[]} [userErrors] A mutation's user errors.
 */

export class TetherError extends Error {
  /**
   * @param {string} message
   * @param {TetherErrorDetails} [details]
   */
  constructor(message, { status, errors, userErrors, code } = {}) {
    super(message);
    this.name = 'TetherError';
    /** @type {TetherErrorCode} */
    this.code = code ?? (status ? `HTTP_${status}` : 'ERROR');
    /** @type {number | undefined} */
    this.status = status;
    /** @type {GraphQLError[] | undefined} */
    this.errors = errors;
    /** @type {readonly UserError[] | undefined} */
    this.userErrors = userErrors;
  }
}

/**
 * What a request needs from a config: the browser's `cfg`, or a config the server helpers build.
 *
 * @typedef {Pick<TetherConfig, 'domain' | 'token' | 'apiVersion' | 'country' | 'language' | 'maxAge' | 'retries'>
 *   & { fetch?: typeof fetch }} StorefrontConfig
 */
/** @typedef {{ context?: boolean }} RequestOptions `context: false` sends the query without `@inContext`. */
/** @typedef {{ inventory: boolean }} StoreAccess What the store's token may read beyond the defaults. */
/**
 * A query's text, or a function that writes it for what the token may read: Tether's own queries, built from
 * `fragments.js`, leave out inventory for a token that can't read it.
 *
 * @typedef {string | ((access: StoreAccess) => string)} QueryText
 */

/**
 * @param {Pick<TetherConfig, 'domain' | 'apiVersion'>} [conf]
 * @returns {string} The Storefront GraphQL endpoint of `conf`'s store.
 */
export function endpoint(conf = cfg) {
  return `https://${conf.domain}/api/${conf.apiVersion}/graphql.json`;
}

/**
 * Adds @inContext(country, language) to the first operation in the document, so prices, currency and translations
 * follow the market. Operations are always written first, fragments after, so the first match is the operation.
 *
 * @param {string} query
 * @param {{ country: CountryCode | undefined, language: LanguageCode | undefined }} market
 * @returns {string}
 */
function inContext(query, { country, language }) {
  const args = [];
  if (country) args.push(`country: ${country}`);
  if (language) args.push(`language: ${language}`);
  if (!args.length || query.includes('@inContext')) return query;

  const tag = `@inContext(${args.join(', ')})`;
  // Named (query Name($x: T)), anonymous (query { … }) and shorthand ({ … }) queries.
  if (/^\s*\{/.test(query)) return `query ${tag} ${query.trimStart()}`;
  return query.replace(/^(\s*(?:query|mutation)(?:\s+\w+)?\s*(?:\([^)]*\))?)/, `$1 ${tag}`);
}

/**
 * `inContext` for any country and language, as the public `Tether.withContext` takes them: one that isn't a valid
 * code is left out, so page input never becomes query text.
 *
 * @param {string} query
 * @param {{ country?: string | undefined, language?: string | undefined }} [ctx]
 * @returns {string}
 */
export function withContext(query, ctx = cfg) {
  const country = toCountry(ctx.country) ?? undefined;
  const language = toLanguage(ctx.language) ?? undefined;
  return inContext(query, { country, language });
}

/** Backoff after a network error or a 429/5xx: this times 2^attempt. */
const RETRY_BACKOFF_MS = 300;
/** Backoff after Shopify's `THROTTLED` error, which asks for a longer wait: this times 2^attempt. */
const THROTTLE_BACKOFF_MS = 500;
/** Shopify's status for a request its bot protection rejected; retrying doesn't help. */
const SECURITY_REJECTION = 430;
const MS_PER_SECOND = 1000;

/**
 * `quantityAvailable` needs the token's `unauthenticated_read_product_inventory` scope; without it Shopify refuses the
 * whole query with an error naming the field. That refusal is learned once per page and store: Tether's later queries
 * to the store are written without the field (`StoreAccess`), so stock levels are unknown and everything else works,
 * for one extra request.
 */
const INVENTORY_FIELD = 'quantityAvailable';

/** @type {Set<string>} The stores (domain, version and token) whose token can't read inventory. */
const storesWithoutInventory = new Set();

/** @param {StorefrontConfig} conf */
const storeOf = (conf) => `${conf.domain} ${conf.apiVersion} ${conf.token}`;

/**
 * @param {StorefrontConfig} conf
 * @param {QueryText} query
 * @param {StoreAccess} access
 * @param {boolean} context
 * @returns {string} The text sent: with the market, and the cache's time bucket for a query.
 */
function queryText(conf, query, access, context) {
  const written = typeof query === 'string' ? query : query(access);
  const text = context ? inContext(written, conf) : written;
  if (conf.maxAge <= 0 || /^\s*mutation\b/.test(text)) return text;
  return `${text} #${Math.floor(Date.now() / (conf.maxAge * MS_PER_SECOND))}`;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What a status means, for errors Shopify sends without a message (401/403 have none).
 *
 * @param {number} status
 * @param {StorefrontConfig} conf
 */
function statusText(status, conf) {
  if (status === 401 || status === 403) {
    const adminHint = conf.token.startsWith('shpat_') ? ', not an Admin API token (shpat_…)' : '';
    return `Shopify rejected the Storefront token for ${conf.domain} (${status}): use the public Storefront API token (Headless channel)${adminHint}`;
  }
  if (status === 404) {
    return `Store or API version not found (404): check domain ${conf.domain} and apiVersion ${conf.apiVersion}`;
  }
  return `HTTP ${status} from ${conf.domain}`;
}

/**
 * @param {unknown} value One entry of a response's `errors`.
 * @returns {GraphQLError} The error, with an empty message when it has none.
 */
function toGraphQLError(value) {
  const message = field(value, 'message');
  const code = field(field(value, 'extensions'), 'code');
  const text = typeof message === 'string' ? message : '';
  return typeof code === 'string' ? { message: text, extensions: { code } } : { message: text };
}

/**
 * @param {unknown} json A response body.
 * @returns {GraphQLResponse | null} The body in the shape the GraphQL spec sets, `null` when it has another one.
 */
function toGraphQLResponse(json) {
  if (!isRecord(json)) return null;
  const { data, errors } = json;
  if (errors === undefined || errors === null) return { data };
  if (!Array.isArray(errors)) return null;
  return { data, errors: errors.map(toGraphQLError) };
}

/**
 * @param {Response} res
 * @param {GraphQLError[]} errors
 * @param {StorefrontConfig} conf
 */
function graphQLFailure(res, errors, conf) {
  const message = errors
    .map((error) => error.message)
    .filter(Boolean)
    .join(' | ');
  let text = message || 'Storefront API error';
  if (!res.ok) text = res.status === 401 || res.status === 403 || !message ? statusText(res.status, conf) : message;
  return new TetherError(text, { status: res.status, errors });
}

/**
 * @typedef {{ kind: 'data', data: unknown }
 *   | { kind: 'retry', backoffMs: number }
 *   | { kind: 'inventory-refused', error: TetherError }} Attempt
 */

/**
 * One request. Failures that retrying can't fix throw.
 *
 * @param {StorefrontConfig} conf
 * @param {string} query
 * @param {Record<string, unknown>} variables
 * @param {boolean} canRetry False on the last attempt: a retryable failure then throws too.
 * @returns {Promise<Attempt>}
 */
async function attempt(conf, query, variables, canRetry) {
  let res;
  try {
    res = await (conf.fetch ?? fetch)(endpoint(conf), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': conf.token },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    if (canRetry) return { kind: 'retry', backoffMs: RETRY_BACKOFF_MS };
    throw new TetherError(`Network error: ${error instanceof Error ? error.message : String(error)}`, {
      code: 'NETWORK',
    });
  }
  if (res.status === SECURITY_REJECTION) {
    throw new TetherError('Shopify security rejection (430)', { status: SECURITY_REJECTION });
  }
  if (canRetry && (res.status === 429 || res.status >= 500)) {
    return { kind: 'retry', backoffMs: RETRY_BACKOFF_MS };
  }

  /** @type {unknown} */
  let json;
  try {
    json = await res.json();
  } catch {
    const text = res.ok ? `Invalid response (${res.status})` : statusText(res.status, conf);
    throw new TetherError(text, { status: res.status });
  }
  const body = toGraphQLResponse(json);
  if (!body) {
    const text = res.ok ? `Invalid response (${res.status})` : statusText(res.status, conf);
    throw new TetherError(text, { status: res.status });
  }
  const { data, errors = [] } = body;
  if (errors.length) {
    if (query.includes(INVENTORY_FIELD) && errors.some((error) => error.message.includes(INVENTORY_FIELD))) {
      return { kind: 'inventory-refused', error: graphQLFailure(res, errors, conf) };
    }
    if (canRetry && errors.some((error) => error.extensions?.code === 'THROTTLED')) {
      return { kind: 'retry', backoffMs: THROTTLE_BACKOFF_MS };
    }
    throw graphQLFailure(res, errors, conf);
  }
  if (!res.ok) throw new TetherError(statusText(res.status, conf), { status: res.status });
  return { kind: 'data', data };
}

/**
 * One Storefront API request, for any config: the browser's shared one (`gql`) or one the server helpers build.
 * Queries carry a time bucket so Shopify's cache of an identical query text is at most `maxAge` seconds old. A query
 * written for the store's access leaves out inventory once the token turns out not to read it (`INVENTORY_FIELD`);
 * a fixed query text is the caller's own, and that refusal is its error.
 *
 * @template T The shape of the query's `data`, which the caller's query text decides.
 * @param {StorefrontConfig} conf
 * @param {QueryText} query
 * @param {Record<string, unknown>} [variables]
 * @param {RequestOptions} [options]
 * @returns {Promise<T>}
 * @throws {TetherError} `NOT_CONFIGURED` without a domain or token, `NETWORK` when the store can't be reached,
 *   `HTTP_<status>` for an HTTP or GraphQL failure.
 */
export async function request(conf, query, variables = {}, { context = true } = {}) {
  if (!conf.domain || !conf.token) {
    throw new TetherError('Tether is not configured: domain and token are required', { code: 'NOT_CONFIGURED' });
  }
  const store = storeOf(conf);
  let retries = 0;
  for (;;) {
    const sent = queryText(conf, query, { inventory: !storesWithoutInventory.has(store) }, context);
    const outcome = await attempt(conf, sent, variables, retries < conf.retries);
    switch (outcome.kind) {
      case 'data':
        // The query text decides the shape of `data`; the caller's `T` states it.
        return /** @type {T} */ (outcome.data);
      case 'inventory-refused':
        if (typeof query === 'string') throw outcome.error;
        log(`the token can't read inventory: ${INVENTORY_FIELD} is left out from now on`);
        storesWithoutInventory.add(store);
        break;
      case 'retry':
        retries += 1;
        log('retry', retries);
        await sleep(outcome.backoffMs * 2 ** retries);
        break;
    }
  }
}

/**
 * `request` with the browser's shared config.
 *
 * @template T
 * @param {QueryText} query
 * @param {Record<string, unknown>} [variables]
 * @param {RequestOptions} [options]
 * @returns {Promise<T>}
 */
export const gql = (query, variables, options) => request(cfg, query, variables, options);

/**
 * @template {{ userErrors?: readonly UserError[] | null }} Payload
 * @param {Payload | null | undefined} payload A mutation's payload.
 * @param {string} name The mutation, for the error message.
 * @returns {Payload}
 * @throws {TetherError} `ERROR` on an empty payload or on user errors (in `userErrors`).
 */
export function unwrap(payload, name) {
  if (!payload) throw new TetherError(`${name}: empty response`);
  const userErrors = payload.userErrors ?? [];
  if (userErrors.length) {
    throw new TetherError(userErrors.map((error) => error.message).join(' | '), { userErrors });
  }
  return payload;
}
