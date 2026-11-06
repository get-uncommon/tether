/**
 * Readers for JSON that arrives from outside: API answers, config files, the state file. Each one turns an `unknown`
 * into the type the caller asked for, so a missing or mistyped field becomes a default instead of a crash later on.
 */

import { isRecord } from './shared/json.ts';

export { asList, textOrNull } from './shared/json.ts';

/** The value's own fields, or an empty record when it is not a plain object. */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * A finite number, also from a decimal string (Shopify's `Money` and `Decimal` scalars are strings), or `null`: an
 * empty or non-numeric string is `null`, never `0` or `NaN`.
 */
export function decimalOrNull(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

/**
 * The answer's body as JSON, or `null` when it is not JSON: an API's edge answers some failures with an HTML page, and
 * then the status says what went wrong.
 */
export async function responseJsonOrNull(response: Pick<Response, 'text'>): Promise<unknown> {
  return jsonOrNull(await response.text());
}

/** The text as JSON, or `null` when it is not JSON. */
export function jsonOrNull(text: string): unknown {
  try {
    const json: unknown = JSON.parse(text);
    return json;
  } catch {
    return null;
  }
}
