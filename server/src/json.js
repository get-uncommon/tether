/**
 * Readers for JSON that arrives from outside: API answers, config files, the state file. Each one turns an `unknown`
 * into the type the caller asked for, so a missing or mistyped field becomes a default instead of a crash later on.
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The value's own fields, or an empty record when it is not a plain object.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asRecord(value) {
  return isPlainObject(value) ? value : {};
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
export function asList(value) {
  return Array.isArray(value) ? /** @type {unknown[]} */ (value) : [];
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

/**
 * A non-empty string, or `null`: Shopify sends `""` and `null` alike for an unset text field.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function textOrNull(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * A number, also from a decimal string (Shopify's `Money` and `Decimal` scalars are strings), or `null`.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function numberOrNull(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return null;
}

/**
 * The response body as JSON, or `null` when it is not JSON: an API's edge answers some failures with an HTML page,
 * and then the status says what went wrong.
 *
 * @param {Response} response
 * @returns {Promise<unknown>}
 */
export async function responseJsonOrNull(response) {
  const text = await response.text();
  try {
    /** @type {unknown} */
    const json = JSON.parse(text);
    return json;
  } catch {
    return null;
  }
}
