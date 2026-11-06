// @ts-nocheck
/**
 * Registers the product webhooks through the app itself, so nobody has to set them up in
 * Shopify's admin. Webhooks created by an app are signed with its client secret, which the
 * Worker already has. Idempotent; after the first run it costs one store read.
 */
export const PRODUCT_TOPICS = ['PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE'];
const KEY = 'webhooks:uri';

export async function ensureWebhooks({ shopify, store, uri, force = false }) {
  if (!force && store && (await store.get(KEY)) === uri)
    return { uri, created: [], existing: PRODUCT_TOPICS, cached: true };
  const current = await shopify.listWebhooks();
  const have = new Set(current.filter((w) => w.uri === uri).map((w) => w.topic));
  const created = [];
  for (const topic of PRODUCT_TOPICS) {
    if (have.has(topic)) continue;
    await shopify.createWebhook(topic, uri);
    created.push(topic);
  }
  if (store) await store.put(KEY, uri);
  // Subscriptions for another URL (e.g. an older Worker) are left alone, but reported.
  const others = current.filter((w) => w.uri !== uri && PRODUCT_TOPICS.includes(w.topic)).map((w) => w.uri);
  return { uri, created, existing: PRODUCT_TOPICS.filter((t) => have.has(t)), others: [...new Set(others)] };
}

export async function webhookStatus({ shopify, uri }) {
  const current = await shopify.listWebhooks();
  const mine = new Set(current.filter((w) => w.uri === uri).map((w) => w.topic));
  return {
    uri,
    registered: PRODUCT_TOPICS.filter((t) => mine.has(t)),
    missing: PRODUCT_TOPICS.filter((t) => !mine.has(t)),
  };
}
