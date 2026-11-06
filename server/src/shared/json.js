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

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * @param {unknown} value
 * @returns {number} A count Shopify always sends; 0 for an answer without it.
 */
export const countOrZero = (value) => numberOrNull(value) ?? 0;

/**
 * @template T
 * @param {unknown} value
 * @param {(item: unknown) => T} read
 * @returns {T[]}
 */
export const listOf = (value, read) => asList(value).map((item) => read(item));

/**
 * @template T
 * @param {unknown} connection A GraphQL connection: `{ nodes: [...] }`.
 * @param {(item: unknown) => T} read
 * @returns {{ nodes: T[] }}
 */
export const nodesOf = (connection, read) => ({ nodes: listOf(field(connection, 'nodes'), read) });

/**
 * @param {unknown} value
 * @returns {string[]} The non-empty strings of a list.
 */
export const textList = (value) => listOf(value, textOrNull).filter((line) => line !== null);
