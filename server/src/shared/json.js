/**
 * Reading JSON that arrives from outside (Shopify's answers, a Worker request body) field by field, for the browser
 * script and the Worker alike. Every reader takes `unknown`, so a missing or mistyped field is `undefined`, never a
 * crash.
 */

/**
 * A plain object, as parsed JSON holds it.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The field `key` of `value`, or `undefined` when `value` is not a plain object.
 *
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
export function field(value, key) {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * The value when it is an array, else an empty list.
 *
 * @param {unknown} value
 * @returns {unknown[]}
 */
export function asList(value) {
  return Array.isArray(value) ? value : [];
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
