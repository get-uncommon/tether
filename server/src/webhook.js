/**
 * Shopify webhook endpoint (products/create, products/update, products/delete).
 * Answers within Shopify's 5 second deadline and does the work afterwards:
 * returns { response, task }; the caller keeps `task` alive (ctx.waitUntil in
 * a Worker, a plain await after responding in Node).
 */
import { verifyShopifyHmac } from './hmac.js';
import { sleep as realSleep } from './util.js';

const TOPICS = new Set(['products/create', 'products/update', 'products/delete']);

const reply = (status, text) => new Response(text, { status, headers: { 'content-type': 'text/plain' } });

export async function handleShopifyWebhook(request, {
  sync, secret, secrets, shopDomain, log, createDelayMs = 3000, sleep = realSleep,
}) {
  if (request.method !== 'POST') return { response: reply(405, 'POST only') };
  const raw = await request.arrayBuffer();
  const hmac = request.headers.get('x-shopify-hmac-sha256');
  const keys = (secrets && secrets.length ? secrets : [secret]).filter(Boolean);
  let valid = false;
  for (const k of keys) { if (await verifyShopifyHmac(raw, hmac, k)) { valid = true; break; } }
  if (!valid) {
    log?.warn?.('webhook rejected: bad HMAC');
    return { response: reply(401, 'invalid signature') };
  }
  const shop = request.headers.get('x-shopify-shop-domain');
  if (shopDomain && shop && shop.toLowerCase() !== shopDomain.toLowerCase()) {
    return { response: reply(403, 'unknown shop') };
  }
  const topic = request.headers.get('x-shopify-topic');
  if (!TOPICS.has(topic)) return { response: reply(200, 'ignored') };

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return { response: reply(400, 'invalid JSON') }; }
  const id = payload.admin_graphql_api_id || payload.id;
  if (!id) return { response: reply(400, 'no product id') };

  const work = async () => {
    try {
      // products/create and products/update arrive together for new products; the
      // update runs first, the delayed create then finds the item and does nothing.
      if (topic === 'products/create' && createDelayMs) await sleep(createDelayMs);
      // The topic header isn't covered by the HMAC, so it never decides on its own: every topic
      // asks Shopify for the product, and only a product Shopify no longer has is removed.
      const res = await sync.syncById(id);
      log?.info?.(`webhook ${topic} ${id}: ${res.action}`);
      return res;
    } catch (err) {
      // Shopify won't retry (we already answered 200): the next reconcile does.
      log?.error?.(`webhook ${topic} ${id} failed: ${err.message}`);
      try { await sync.queueRetry?.(id, err); } catch { /* the cursor overlap still catches most */ }
      return { action: 'failed', error: err };
    }
  };
  return { response: reply(200, 'ok'), task: work() };
}
