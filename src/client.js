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

export function endpoint() {
  return `https://${cfg.domain}/api/${cfg.apiVersion}/graphql.json`;
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

  return query.replace(
    /^(\s*(?:query|mutation)\s+\w+\s*(?:\([^)]*\))?)/,
    `$1 @inContext(${args.join(', ')})`,
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function gql(query, variables = {}, { context = true } = {}) {
  if (!cfg.domain || !cfg.token) {
    throw new TetherError('Tether is not configured: domain and token are required', { code: 'NOT_CONFIGURED' });
  }

  const body = JSON.stringify({ query: context ? withContext(query) : query, variables });
  let attempt = 0;

  for (;;) {
    let res;
    try {
      res = await fetch(endpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': cfg.token,
        },
        body,
      });
    } catch (err) {
      if (attempt++ < cfg.retries) { await sleep(300 * 2 ** attempt); continue; }
      throw new TetherError(`Network error: ${err.message}`, { code: 'NETWORK' });
    }

    if (res.status === 430) throw new TetherError('Shopify security rejection (430)', { status: 430 });

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt++ < cfg.retries) {
      log('retry', res.status, attempt);
      await sleep(300 * 2 ** attempt);
      continue;
    }

    let json;
    try { json = await res.json(); } catch {
      throw new TetherError(`Invalid response (${res.status})`, { status: res.status });
    }

    if (json.errors?.length) {
      // Token without unauthenticated_read_product_inventory: drop the field and retry.
      const inventoryDenied = json.errors.some((e) => /quantityAvailable/.test(e.message || ''));
      if (inventoryDenied && /\bquantityAvailable\b/.test(body)) {
        log('no inventory permission, retrying without quantityAvailable');
        return gql(query.replace(/\bquantityAvailable\b/g, ''), variables, { context });
      }
      const throttled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt++ < cfg.retries) { await sleep(500 * 2 ** attempt); continue; }
      throw new TetherError(json.errors.map((e) => e.message).join(' | '), {
        status: res.status, errors: json.errors,
      });
    }
    if (!res.ok) throw new TetherError(`HTTP ${res.status}`, { status: res.status });

    return json.data;
  }
}

/** Throws on mutation userErrors, returns the payload otherwise. */
export function unwrap(payload, name) {
  if (!payload) throw new TetherError(`${name}: empty response`);
  const errs = payload.userErrors || [];
  if (errs.length) {
    throw new TetherError(errs.map((e) => e.message).join(' | '), { userErrors: errs });
  }
  return payload;
}
