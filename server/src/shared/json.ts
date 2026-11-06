/**
 * Reading JSON that arrives from outside (Shopify's answers, a Worker request body) field by field, for the browser
 * script and the Worker alike. Every reader takes `unknown`, so a missing or mistyped field is `undefined`, never a
 * crash.
 */

/** A plain object, as parsed JSON holds it. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The field `key` of `value`, or `undefined` when `value` is not a plain object. */
export function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** The value when it is an array, else an empty list. */
export function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A non-empty string, or `null`: Shopify sends `""` and `null` alike for an unset text field. */
export function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** A count Shopify always sends; 0 for an answer without it. */
export const countOrZero = (value: unknown): number => numberOrNull(value) ?? 0;

export const listOf = <T>(value: unknown, read: (item: unknown) => T): T[] => asList(value).map((item) => read(item));

/**
 * @param connection A GraphQL connection: `{ nodes: [...] }`.
 */
export const nodesOf = <T>(connection: unknown, read: (item: unknown) => T): { nodes: T[] } => ({
  nodes: listOf(field(connection, 'nodes'), read),
});

/** The non-empty strings of a list. */
export const textList = (value: unknown): string[] => listOf(value, textOrNull).filter((line) => line !== null);
