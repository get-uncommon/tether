/**
 * Readers for JSON that arrives from outside: API answers, config files, the state file. Each one turns an `unknown`
 * into the type the caller asked for, so a missing or mistyped field becomes a default instead of a crash later on.
 */

import { isRecord } from './shared/json.js';

export { asList, isRecord as isPlainObject, textOrNull } from './shared/json.js';

/**
 * The value's own fields, or an empty record when it is not a plain object.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asRecord(value) {
  return isRecord(value) ? value : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

/**
 * A finite number, also from a decimal string (Shopify's `Money` and `Decimal` scalars are strings), or `null`: an
 * empty or non-numeric string is `null`, never `0` or `NaN`.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function numberOrNull(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

/**
 * The body as JSON, or `null` when it is not JSON: an API's edge answers some failures with an HTML page, and then
 * the status says what went wrong; a request body that isn't JSON is refused field by field by its reader.
 *
 * @param {Pick<Body, 'text'>} message A `Response` or a `Request`.
 * @returns {Promise<unknown>}
 */
export async function responseJsonOrNull(message) {
  const text = await message.text();
  try {
    /** @type {unknown} */
    const json = JSON.parse(text);
    return json;
  } catch {
    return null;
  }
}
