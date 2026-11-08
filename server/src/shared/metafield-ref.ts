/**
 * Metafield references (`namespace.key`), which the browser's product fragment and the sync's product query write
 * into their text: a GraphQL fragment can't declare variables, so they can't be sent as variables. Only these
 * characters are let through, which covers Shopify's namespaces and keys.
 */

const METAFIELD_KEY = /^[A-Za-z0-9_.-]+$/;
/** A namespace is the same, or an app-reserved one: `$app` or `$app:<name>`. */
const METAFIELD_NAMESPACE = /^(\$app(:[A-Za-z0-9_-]+)?|[A-Za-z0-9_.-]+)$/;

/** @returns True when both parts are ones a query may hold. */
export const isMetafieldIdentifier = (namespace: string, key: string): boolean =>
  METAFIELD_NAMESPACE.test(namespace) && METAFIELD_KEY.test(key);

/**
 * @param ref `namespace.key`: the namespace ends at the first dot, and the key may hold more.
 * @returns Its parts, `null` when there is no namespace or either part isn't valid.
 */
export function metafieldIdentifierOf(ref: string): { namespace: string; key: string } | null {
  const dot = ref.indexOf('.');
  if (dot <= 0) return null;
  const namespace = ref.slice(0, dot);
  const key = ref.slice(dot + 1);
  return isMetafieldIdentifier(namespace, key) ? { namespace, key } : null;
}
