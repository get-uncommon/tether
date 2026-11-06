/**
 * Registers the product webhooks through the app itself, so nobody has to set them up in
 * Shopify's admin. Webhooks created by an app are signed with its client secret, which the
 * Worker already has. Idempotent.
 */

import type { Store } from './store.ts';

interface WebhookSubscription {
  topic: string;
  uri: string;
}

/** The part of the Shopify client that manages webhook subscriptions. */
export interface WebhookAdmin {
  /** This app's subscriptions. */
  listWebhooks: () => Promise<WebhookSubscription[]>;
  createWebhook: (topic: string, uri: string) => Promise<unknown>;
}

/** `cached`: Shopify was not asked, so nothing is known about what it holds. */
type EnsureResult =
  | { uri: string; created: []; cached: true; existing?: undefined; others?: undefined }
  | { uri: string; created: string[]; existing: string[]; others: string[] };

export const PRODUCT_TOPICS = ['PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE'];
/** The URI the subscriptions were last registered for. */
const KEY = 'webhooks:uri';

interface EnsureOptions {
  shopify: WebhookAdmin;
  store?: Store | null | undefined;
  uri: string;
  force?: boolean;
}

/**
 * Subscribes `uri` to every product topic it is missing. Subscriptions for another URI (another Worker) are left
 * alone, and reported in `others`. Without `force`, a `uri` registered before is taken on trust; Shopify deletes
 * subscriptions whose deliveries keep failing, so a caller that must recover them passes `force`.
 */
export async function ensureWebhooks({ shopify, store, uri, force = false }: EnsureOptions): Promise<EnsureResult> {
  const registered = store ? await store.get(KEY) : null;
  if (!force && registered === uri) return { uri, created: [], cached: true };
  const current = await shopify.listWebhooks();
  const have = new Set(current.filter((webhook) => webhook.uri === uri).map((webhook) => webhook.topic));
  const created: string[] = [];
  for (const topic of PRODUCT_TOPICS) {
    if (have.has(topic)) continue;
    await shopify.createWebhook(topic, uri);
    created.push(topic);
  }
  if (store && registered !== uri) await store.put(KEY, uri);
  const others = current
    .filter((webhook) => webhook.uri !== uri && PRODUCT_TOPICS.includes(webhook.topic))
    .map((webhook) => webhook.uri);
  return { uri, created, existing: PRODUCT_TOPICS.filter((topic) => have.has(topic)), others: [...new Set(others)] };
}

export async function webhookStatus({
  shopify,
  uri,
}: {
  shopify: WebhookAdmin;
  uri: string;
}): Promise<{ uri: string; registered: string[]; missing: string[] }> {
  const current = await shopify.listWebhooks();
  const mine = new Set(current.filter((webhook) => webhook.uri === uri).map((webhook) => webhook.topic));
  return {
    uri,
    registered: PRODUCT_TOPICS.filter((topic) => mine.has(topic)),
    missing: PRODUCT_TOPICS.filter((topic) => !mine.has(topic)),
  };
}
