/** Small shared helpers. Web-standard APIs only, so this runs in Workers and Node 20+. */

/** Where the sync reports progress. {@link noopLogger} stands in when the caller passes none. */
export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface SyncErrorDetails {
  status?: number | undefined;
  body?: unknown;
  code?: string | undefined;
}

export class SyncError extends Error {
  /** The HTTP status of the failed request, when one failed. */
  status: number | undefined;
  /** The parsed response body of the failed request. */
  body: unknown;
  code: string;

  constructor(message: string, { status, body, code }: SyncErrorDetails = {}) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
    this.body = body;
    this.code = code || (status ? `HTTP_${status}` : 'ERROR');
  }
}

/** The HTTP status a failed request reported, or `undefined` for any other error. */
export function httpStatusOf(error: unknown): number | undefined {
  return error instanceof SyncError ? error.status : undefined;
}

/** A plain object, as parsed JSON or a store value holds it. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A scalar as text, the way `String` writes it; `''` for an object or a function, which has no meaningful text. */
export function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** JSON with sorted keys, so equal data always hashes the same. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record: Record<string, unknown> = { ...value };
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export async function sha256(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** gid://shopify/Product/123 -> "123"; "123" -> "123". */
export function numericId(id: string | number): string {
  const text = String(id);
  return text.slice(text.lastIndexOf('/') + 1);
}

export const productGid = (id: string | number): string =>
  String(id).startsWith('gid://') ? String(id) : `gid://shopify/Product/${String(id)}`;

/** A logger that drops every message, for callers that pass none. */
function dropMessage() {
  // Nothing to report to.
}

export const noopLogger: Logger = { info: dropMessage, warn: dropMessage, error: dropMessage, debug: dropMessage };
