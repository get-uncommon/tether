/** Small shared helpers. Web-standard APIs only, so this runs in Workers and Node 20+. */

/**
 * Where the sync reports progress. {@link noopLogger} stands in when the caller passes none.
 *
 * @typedef {object} Logger
 * @property {(...args: unknown[]) => void} info
 * @property {(...args: unknown[]) => void} warn
 * @property {(...args: unknown[]) => void} error
 * @property {(...args: unknown[]) => void} [debug]
 */

/** @param {number} ms @returns {Promise<void>} */
export const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** @typedef {{ status?: number | undefined, body?: unknown, code?: string | undefined }} SyncErrorDetails */

export class SyncError extends Error {
  /**
   * @param {string} message
   * @param {SyncErrorDetails} [details]
   */
  constructor(message, { status, body, code } = {}) {
    super(message);
    this.name = 'SyncError';
    /** The HTTP status of the failed request, when one failed. */
    this.status = status;
    /** The parsed response body of the failed request. */
    this.body = body;
    this.code = code || (status ? `HTTP_${status}` : 'ERROR');
  }
}

/**
 * The HTTP status a failed request reported, or `undefined` for any other error.
 *
 * @param {unknown} error
 */
export function httpStatusOf(error) {
  return error instanceof SyncError ? error.status : undefined;
}

/**
 * A plain object, as parsed JSON or a store value holds it.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A scalar as text, the way `String` writes it; `''` for an object or a function, which has no meaningful text.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function scalarText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}

/** @param {unknown} error */
export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * JSON with sorted keys, so equal data always hashes the same.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = /** @type {Record<string, unknown>} */ (value);
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

/** @param {string} text @returns {Promise<string>} */
export async function sha256(text) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * gid://shopify/Product/123 -> "123"; "123" -> "123".
 *
 * @param {string | number} id
 * @returns {string}
 */
export function numericId(id) {
  const text = String(id);
  return text.slice(text.lastIndexOf('/') + 1);
}

/** @param {string | number} id @returns {string} */
export const productGid = (id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/Product/${id}`);

/** A logger that drops every message, for callers that pass none. */
function dropMessage() {
  // Nothing to report to.
}

/** @type {Logger} */
export const noopLogger = { info: dropMessage, warn: dropMessage, error: dropMessage, debug: dropMessage };
