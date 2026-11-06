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
  if (!Array.isArray(value)) return [];
  /** @type {unknown[]} */
  const list = value;
  return list;
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
