/**
 * Reading JSON that arrives from outside (Shopify's answers, a Worker request body) field by field, for the browser
 * script and the Worker alike. Every reader takes `unknown`, so a missing or mistyped field is `undefined`, never a
 * crash.
 */
/** A plain object, as parsed JSON holds it. */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** The field `key` of `value`, or `undefined` when `value` is not a plain object. */
export declare function field(value: unknown, key: string): unknown;
/** The value when it is an array, else an empty list. */
export declare function asList(value: unknown): unknown[];
/** A non-empty string, or `null`: Shopify sends `""` and `null` alike for an unset text field. */
export declare function textOrNull(value: unknown): string | null;
export declare const numberOrNull: (value: unknown) => number | null;
/** A count Shopify always sends; 0 for an answer without it. */
export declare const countOrZero: (value: unknown) => number;
export declare const listOf: <T>(value: unknown, read: (item: unknown) => T) => T[];
/**
 * @param connection A GraphQL connection: `{ nodes: [...] }`.
 */
export declare const nodesOf: <T>(connection: unknown, read: (item: unknown) => T) => {
    nodes: T[];
};
/** The non-empty strings of a list. */
export declare const textList: (value: unknown) => string[];
