/**
 * The Shopify webhook endpoint (products/create, products/update, products/delete). It answers within Shopify's
 * five-second deadline and does the work afterwards: it returns `{ response, task }`, and the caller keeps `task`
 * alive (`ctx.waitUntil` in a Worker, a plain await after responding in Node).
 */
import { verifyShopifyHmac } from './hmac.js';
import { sleep as realSleep } from './util.js';

/** Largest webhook body read. Shopify's product webhooks are a few KB. */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

const TOPICS = new Set(['products/create', 'products/update', 'products/delete']);
/** products/create and products/update arrive together for a new product; the create waits so the update goes first. */
const CREATE_DELAY_MS = 3000;

/**
 * @typedef {object} WebhookSync The part of the sync engine a webhook drives.
 * @property {(id: string) => Promise<{ action: string }>} syncById
 * @property {(id: string, error: unknown) => Promise<void>} [queueRetry]
 */

/**
 * @typedef {object} WebhookLog
 * @property {(message: string) => void} [info]
 * @property {(message: string) => void} [warn]
 * @property {(message: string) => void} [error]
 */

/**
 * @typedef {object} WebhookOptions
 * @property {WebhookSync} sync
 * @property {string[]} secrets Keys a webhook may be signed with (the app's client secret, an admin webhook key).
 * @property {string} shopDomain The store's `.myshopify.com` domain; webhooks from any other shop are refused.
 * @property {WebhookLog} [log]
 * @property {number} [createDelayMs]
 * @property {(ms: number) => Promise<void>} [sleep]
 */

/** @param {number} status @param {string} text */
function reply(status, text) {
  return new Response(text, { status, headers: { 'content-type': 'text/plain' } });
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The body, or `null` when it is longer than {@link MAX_WEBHOOK_BYTES}.
 *
 * @param {Request} request
 * @returns {Promise<Uint8Array<ArrayBuffer> | null>}
 */
async function readCappedBody(request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_WEBHOOK_BYTES) return null;
  if (!request.body) return new Uint8Array();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * The product a webhook is about: Shopify sends its gid and, for older API versions, only the numeric id.
 *
 * @param {unknown} payload
 * @returns {string | null}
 */
function productIdOf(payload) {
  if (payload === null || typeof payload !== 'object') return null;
  const { admin_graphql_api_id: gid, id } = /** @type {Record<string, unknown>} */ (payload);
  if (typeof gid === 'string' && gid) return gid;
  if (typeof id === 'number' || (typeof id === 'string' && id)) return String(id);
  return null;
}

/**
 * @param {Request} request
 * @param {WebhookOptions} options
 * @returns {Promise<{ response: Response, task?: Promise<{ action: string, error?: unknown }> }>}
 */
export async function handleShopifyWebhook(
  request,
  { sync, secrets, shopDomain, log, createDelayMs = CREATE_DELAY_MS, sleep = realSleep },
) {
  if (request.method !== 'POST') return { response: reply(405, 'POST only') };
  const raw = await readCappedBody(request);
  if (!raw) return { response: reply(413, 'too large') };
  const signature = request.headers.get('x-shopify-hmac-sha256');
  const checks = await Promise.all(secrets.filter(Boolean).map((key) => verifyShopifyHmac(raw, signature, key)));
  if (!checks.includes(true)) {
    log?.warn?.('webhook rejected: bad HMAC');
    return { response: reply(401, 'invalid signature') };
  }
  // One app's client secret signs webhooks for every shop it is installed on, so the shop must be this Worker's.
  const shop = request.headers.get('x-shopify-shop-domain') ?? '';
  const expectedShop = shopDomain.toLowerCase();
  if (!expectedShop || shop.toLowerCase() !== expectedShop) return { response: reply(403, 'unknown shop') };
  const topic = request.headers.get('x-shopify-topic') ?? '';
  if (!TOPICS.has(topic)) return { response: reply(200, 'ignored') };

  /** @type {unknown} */
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { response: reply(400, 'invalid JSON') };
  }
  const id = productIdOf(payload);
  if (!id) return { response: reply(400, 'no product id') };

  const work = async () => {
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
      await sync.queueRetry?.(id, error).catch((/** @type {unknown} */ queueError) => {
        log?.error?.(
          `webhook ${topic} ${id}: retry not queued (${messageOf(queueError)}); the reconcile cursor still covers it`,
        );
      });
      return { action: 'failed', error };
    }
  };
  return { response: reply(200, 'ok'), task: work() };
}
