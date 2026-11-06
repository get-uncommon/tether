/**
 * Registers the product webhooks through the app itself, so nobody has to set them up in
 * Shopify's admin. Webhooks created by an app are signed with its client secret, which the
 * Worker already has. Idempotent; after the first run it costs one store read.
 */

/** @typedef {import('./store.js').Store} Store */

/** @typedef {{ topic: string, uri: string }} WebhookSubscription */

/**
 * The part of the Shopify client that manages webhook subscriptions.
 *
 * @typedef {object} WebhookAdmin
 * @property {() => Promise<WebhookSubscription[]>} listWebhooks This app's subscriptions.
 * @property {(topic: string, uri: string) => Promise<unknown>} createWebhook
 */

/**
 * @typedef {{ uri: string, created: string[], existing: string[], cached: true, others?: undefined }
 *   | { uri: string, created: string[], existing: string[], others: string[] }} EnsureResult
 */

export const PRODUCT_TOPICS = ['PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE'];
/** The URI the subscriptions were last registered for. */
const KEY = 'webhooks:uri';

/**
 * Subscribes `uri` to every product topic it is missing. Subscriptions for another URI (another Worker) are left
 * alone, and reported in `others`.
 *
 * @param {{ shopify: WebhookAdmin, store?: Store | null, uri: string, force?: boolean }} options
 * @returns {Promise<EnsureResult>}
 */
export async function ensureWebhooks({ shopify, store, uri, force = false }) {
  if (!force && store && (await store.get(KEY)) === uri)
    return { uri, created: [], existing: PRODUCT_TOPICS, cached: true };
  const current = await shopify.listWebhooks();
  const have = new Set(current.filter((webhook) => webhook.uri === uri).map((webhook) => webhook.topic));
  /** @type {string[]} */
  const created = [];
  for (const topic of PRODUCT_TOPICS) {
    if (have.has(topic)) continue;
    await shopify.createWebhook(topic, uri);
    created.push(topic);
  }
  if (store) await store.put(KEY, uri);
  const others = current
    .filter((webhook) => webhook.uri !== uri && PRODUCT_TOPICS.includes(webhook.topic))
    .map((webhook) => webhook.uri);
  return { uri, created, existing: PRODUCT_TOPICS.filter((topic) => have.has(topic)), others: [...new Set(others)] };
}

/**
 * @param {{ shopify: WebhookAdmin, uri: string }} options
 * @returns {Promise<{ uri: string, registered: string[], missing: string[] }>}
 */
export async function webhookStatus({ shopify, uri }) {
  const current = await shopify.listWebhooks();
  const mine = new Set(current.filter((webhook) => webhook.uri === uri).map((webhook) => webhook.topic));
  return {
    uri,
    registered: PRODUCT_TOPICS.filter((topic) => mine.has(topic)),
    missing: PRODUCT_TOPICS.filter((topic) => !mine.has(topic)),
  };
}
