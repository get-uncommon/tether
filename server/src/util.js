/** Small shared helpers. Web-standard APIs only, so this runs in Workers and Node 20+. */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SyncError extends Error {
  constructor(message, { status, body, code } = {}) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
    this.body = body;
    this.code = code || (status ? `HTTP_${status}` : 'ERROR');
  }
}

/** JSON with sorted keys, so equal data always hashes the same. */
export function stableStringify(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** gid://shopify/Product/123 -> "123"; "123" -> "123". */
export const numericId = (id) => (id == null ? null : String(id).split('/').pop());
export const productGid = (id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/Product/${id}`);

export const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
