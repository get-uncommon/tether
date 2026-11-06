/**
 * The Shopify webhook endpoint (products/create, products/update, products/delete). It answers within Shopify's
 * five-second deadline and does the work afterwards: it returns `{ response, task }`, and the caller keeps `task`
 * alive (`ctx.waitUntil` in a Worker, a plain await after responding in Node).
 *
 * A signed webhook replayed later is harmless: no webhook changes anything by itself. Each one only makes the sync ask
 * Shopify for the product's current state, and the sync writes to Webflow and KV only when that state differs from
 * what it last wrote. A replay therefore costs one Shopify read, one KV read and their subrequests, never a write.
 * Repeats of one delivery are dropped by their `X-Shopify-Webhook-Id` without any KV write, because KV's free plan
 * allows only 1,000 writes a day: first by the ids this isolate accepted, then by Cloudflare's Cache API, which every
 * isolate of the data centre shares and which costs nothing. Cloudflare's Cache API works only for a Worker on the
 * shop's own zone (a custom domain or a route), and only when Shopify sends the webhooks there: they go to the origin
 * `/reconcile` was called on. On `*.workers.dev` a repeat that reaches another isolate is synced again.
 */
import { readRequestCapped } from './capped-body.ts';
import { verifyShopifyHmac } from './hmac.ts';
import { isRecord } from './shared/json.ts';
import { messageOf, sleep as realSleep } from './util.ts';
import type { SyncAction } from './sync-product.ts';

/** Largest webhook body read. Shopify's product webhooks are a few KB. */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

const TOPICS = new Set(['products/create', 'products/update', 'products/delete']);
/** products/create and products/update arrive together for a new product; the create waits so the update goes first. */
const CREATE_DELAY_MS = 3000;
/** At most this many webhook ids are remembered, so memory stays bounded; the oldest are forgotten first. */
const RECENT_WEBHOOK_IDS = 500;

/** The `X-Shopify-Webhook-Id`s this isolate accepted, oldest first. */
const recentWebhookIds = new Set<string>();

/**
 * How long the data centre's cache remembers a delivery. Shopify sends a repeat within minutes of the first; a later
 * replay only costs reads (see the file's comment).
 */
const DELIVERY_TTL_SECONDS = 6 * 60 * 60;

/** The part of the Cache API the webhook uses, as the Worker's `caches.open()` gives it. Node has no Cache API. */
export interface DeliveryCache {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
}

/** What a webhook's sync did: the sync's action, or `failed` with the error, which the next reconcile retries. */
type WebhookOutcome = { action: SyncAction } | { action: 'failed'; error: unknown };

/** The part of the sync engine a webhook drives. */
interface WebhookSync {
  syncById: (id: string) => Promise<{ action: SyncAction }>;
  queueRetry: (id: string, error: unknown) => Promise<void>;
}

interface WebhookLog {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

interface WebhookOptions {
  sync: WebhookSync;
  /** Keys a webhook may be signed with (the app's client secret, an admin webhook key). */
  secrets: string[];
  /** The store's `.myshopify.com` domain; webhooks from any other shop are refused. */
  shopDomain: string;
  log?: WebhookLog;
  /**
   * The deliveries other isolates of the data centre accepted. Without it (in Node) only this process's are known;
   * on `*.workers.dev`, where the Cache API stores nothing, it never finds one.
   */
  deliveries?: DeliveryCache | null;
  createDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function reply(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/plain' } });
}

/** Whether this isolate already accepted the delivery with this id, remembering it otherwise. */
function isRepeatInIsolate(webhookId: string): boolean {
  if (recentWebhookIds.has(webhookId)) return true;
  recentWebhookIds.add(webhookId);
  if (recentWebhookIds.size > RECENT_WEBHOOK_IDS) {
    // A Set iterates in insertion order, so its first entry is the oldest.
    for (const oldest of recentWebhookIds) {
      recentWebhookIds.delete(oldest);
      break;
    }
  }
  return false;
}

/**
 * Whether another isolate already accepted the delivery, remembering it otherwise. A cache that fails is logged and
 * the delivery synced: a repeat costs only reads.
 *
 * @param requestUrl The cache keys are URLs, on the Worker's own host.
 */
async function isRepeatInDataCentre(
  webhookId: string,
  deliveries: DeliveryCache,
  requestUrl: string,
  log: WebhookLog | undefined,
): Promise<boolean> {
  const key = new Request(new URL(`/_tether/webhook-delivery/${encodeURIComponent(webhookId)}`, requestUrl));
  try {
    if (await deliveries.match(key)) return true;
    await deliveries.put(key, new Response('1', { headers: { 'Cache-Control': `max-age=${DELIVERY_TTL_SECONDS}` } }));
  } catch (error) {
    log?.warn?.(`webhook ${webhookId}: the delivery cache failed (${messageOf(error)}); synced anyway`);
  }
  return false;
}

/** Whether the delivery with this id was accepted already. A webhook without an id is never a repeat. */
async function isRepeat(
  request: Request,
  deliveries: DeliveryCache | null,
  log: WebhookLog | undefined,
): Promise<boolean> {
  const webhookId = request.headers.get('x-shopify-webhook-id');
  if (!webhookId) return false;
  if (isRepeatInIsolate(webhookId)) return true;
  return deliveries ? isRepeatInDataCentre(webhookId, deliveries, request.url, log) : false;
}

/** The product a webhook is about: Shopify sends its gid and, for older API versions, only the numeric id. */
function productIdOf(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const { admin_graphql_api_id: gid, id } = payload;
  if (typeof gid === 'string' && gid) return gid;
  if (typeof id === 'number' || (typeof id === 'string' && id)) return String(id);
  return null;
}

export async function handleShopifyWebhook(
  request: Request,
  {
    sync,
    secrets,
    shopDomain,
    log,
    deliveries = null,
    createDelayMs = CREATE_DELAY_MS,
    sleep = realSleep,
  }: WebhookOptions,
): Promise<{ response: Response; task?: Promise<WebhookOutcome> }> {
  if (request.method !== 'POST') return { response: reply(405, 'POST only') };
  const raw = await readRequestCapped(request, MAX_WEBHOOK_BYTES);
  if (!raw) return { response: reply(413, 'too large') };
  const signature = request.headers.get('x-shopify-hmac-sha256');
  const checks = await Promise.all(secrets.filter(Boolean).map((key) => verifyShopifyHmac(raw, signature, key)));
  if (!checks.includes(true)) {
    log?.warn?.('webhook rejected: bad HMAC');
    return { response: reply(401, 'invalid signature') };
  }
  // The HMAC key is the app's, not the shop's: one app's client secret signs webhooks for every shop it is installed
  // on. The shop header isn't covered by the signature, so this check is defence in depth against a webhook meant for
  // another shop, not proof of where it came from; the sync only ever reads products from this Worker's own shop.
  const shop = request.headers.get('x-shopify-shop-domain') ?? '';
  const expectedShop = shopDomain.toLowerCase();
  if (!expectedShop || shop.toLowerCase() !== expectedShop) return { response: reply(403, 'unknown shop') };
  const topic = request.headers.get('x-shopify-topic') ?? '';
  if (!TOPICS.has(topic)) return { response: reply(200, 'ignored') };

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { response: reply(400, 'invalid JSON') };
  }
  const id = productIdOf(payload);
  if (!id) return { response: reply(400, 'no product id') };
  if (await isRepeat(request, deliveries, log)) return { response: reply(200, 'already received') };

  const work = async (): Promise<WebhookOutcome> => {
    try {
      if (topic === 'products/create' && createDelayMs) await sleep(createDelayMs);
      // The topic header isn't covered by the HMAC, so it never decides on its own: every topic asks Shopify for the
      // product, and only a product Shopify no longer has is removed.
      const result = await sync.syncById(id);
      log?.info?.(`webhook ${topic} ${id}: ${result.action}`);
      return result;
    } catch (error) {
      // Shopify won't send it again (it was answered 200), so the next reconcile retries it.
      log?.error?.(`webhook ${topic} ${id} failed: ${messageOf(error)}`);
      await sync.queueRetry(id, error).catch((queueError: unknown) => {
        log?.error?.(
          `webhook ${topic} ${id}: retry not queued (${messageOf(queueError)}); the reconcile cursor still covers it`,
        );
      });
      return { action: 'failed', error };
    }
  };
  return { response: reply(200, 'ok'), task: work() };
}
