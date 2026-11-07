/**
 * Metafield references (`namespace.key`), which the browser's product fragment and the sync's product query write
 * into their text: a GraphQL fragment can't declare variables, so they can't be sent as variables. Only these
 * characters are let through, which covers Shopify's namespaces and keys.
 */
/** @returns True when both parts are ones a query may hold. */
export declare const isMetafieldIdentifier: (namespace: string, key: string) => boolean;
/**
 * @param ref `namespace.key`: the namespace ends at the first dot, and the key may hold more.
 * @returns Its parts, `null` when there is no namespace or either part isn't valid.
 */
export declare function metafieldIdentifierOf(ref: string): {
    namespace: string;
    key: string;
} | null;
