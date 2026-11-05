/**
 * Storefront API client: one fetch wrapper with @inContext, retries and
 * readable errors. Exposed as Tether.query() for anything Tether doesn't cover.
 */
import { cfg, log } from './config.js';

export class TetherError extends Error {
  constructor(message, { status, errors, userErrors, code } = {}) {
    super(message);
    this.name = 'TetherError';
    this.code = code || (status ? `HTTP_${status}` : 'ERROR');
    this.status = status;
    this.errors = errors;
    this.userErrors = userErrors;
  }
}

export function endpoint(conf = cfg) {
  return `https://${conf.domain}/api/${conf.apiVersion}/graphql.json`;
}

/**
 * Adds @inContext(country, language) to the first operation in the document,
 * so prices, currency and translations follow the configured market.
 * Operations are always written first, fragments after, so the first match is
 * the operation.
 */
export function withContext(query, ctx = cfg) {
  const args = [];
  if (ctx.country) args.push(`country: ${String(ctx.country).toUpperCase()}`);
  if (ctx.language) args.push(`language: ${String(ctx.language).toUpperCase().replace('-', '_')}`);
  if (!args.length || /@inContext/.test(query)) return query;

  const tag = `@inContext(${args.join(', ')})`;
  // Named (query Name($x: T)), anonymous (query { … }) and shorthand ({ … }) queries.
  if (/^\s*\{/.test(query)) return `query ${tag} ${query.trimStart()}`;
  return query.replace(/^(\s*(?:query|mutation)(?:\s+\w+)?\s*(?:\([^)]*\))?)/, `$1 ${tag}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What a status means, for errors Shopify sends without a message (401/403 have none). */
function statusText(status, conf) {
  if (status === 401 || status === 403) {
    return `Shopify rejected the Storefront token for ${conf.domain} (${status}): use the public Storefront API token (Headless channel)${/^shpat_/.test(conf.token) ? ', not an Admin API token (shpat_…)' : ''}`;
  }
  return status === 404 ? `Store or API version not found (404): check domain ${conf.domain} and apiVersion ${conf.apiVersion}` : `HTTP ${status} from ${conf.domain}`;
}

/**
 * One Storefront API request with retries, for any config object (the browser's shared config,
 * or the server module's own). gql() below is the browser version.
 */
export async function request(conf, query, variables = {}, { context = true } = {}) {
  if (!conf.domain || !conf.token) {
    throw new TetherError('Tether is not configured: domain and token are required', { code: 'NOT_CONFIGURED' });
  }

  // Shopify caches the response of an identical query text (prices included, for hours after a
  // change). A time bucket in a comment keeps answers at most maxAge seconds old (default 60).
  let text = context ? withContext(query, conf) : query;
  const age = conf.maxAge ?? 60;
  if (age > 0 && !/^\s*mutation\b/.test(text)) text += ` #${Math.floor(Date.now() / (age * 1000))}`;
  const body = JSON.stringify({ query: text, variables });
  let attempt = 0;

  for (;;) {
    let res;
    try {
      res = await (conf.fetch || fetch)(endpoint(conf), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': conf.token,
        },
        body,
      });
    } catch (err) {
      if (attempt++ < conf.retries) { await sleep(300 * 2 ** attempt); continue; }
      throw new TetherError(`Network error: ${err.message}`, { code: 'NETWORK' });
    }

    if (res.status === 430) throw new TetherError('Shopify security rejection (430)', { status: 430 });

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt++ < conf.retries) {
      log('retry', res.status, attempt);
      await sleep(300 * 2 ** attempt);
      continue;
    }

    let json;
    try { json = await res.json(); } catch {
      throw new TetherError(res.ok ? `Invalid response (${res.status})` : statusText(res.status, conf), { status: res.status });
    }

    if (json.errors?.length) {
      // Token without unauthenticated_read_product_inventory: drop the field and retry.
      const inventoryDenied = json.errors.some((e) => /quantityAvailable/.test(e.message || ''));
      if (inventoryDenied && /\bquantityAvailable\b/.test(body)) {
        log('no inventory permission, retrying without quantityAvailable');
        return request(conf, query.replace(/\bquantityAvailable\b/g, ''), variables, { context });
      }
      // An older apiVersion without cart warnings (before 2024-07): retry without them.
      if (json.errors.some((e) => /'warnings'/.test(e.message || '')) && /warnings \{ code message target \}/.test(query)) {
        return request(conf, query.replace(/ warnings \{ code message target \}/g, ''), variables, { context });
      }
      const throttled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt++ < conf.retries) { await sleep(500 * 2 ** attempt); continue; }
      const message = json.errors.map((e) => e.message).filter(Boolean).join(' | ');
      throw new TetherError(res.ok ? message || 'Storefront API error' : (res.status === 401 || res.status === 403 || !message ? statusText(res.status, conf) : message), {
        status: res.status, errors: json.errors,
      });
    }
    if (!res.ok) throw new TetherError(statusText(res.status, conf), { status: res.status });

    return json.data;
  }
}

export const gql = (query, variables, opts) => request(cfg, query, variables, opts);

/** Throws on mutation userErrors, returns the payload otherwise. */
export function unwrap(payload, name) {
  if (!payload) throw new TetherError(`${name}: empty response`);
  const errs = payload.userErrors || [];
  if (errs.length) {
    throw new TetherError(errs.map((e) => e.message).join(' | '), { userErrors: errs });
  }
  return payload;
}
