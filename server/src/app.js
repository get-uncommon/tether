/** Wires config + secrets into a sync instance. Shared by the Worker and the CLI. */
import { normalizeConfig, cleanEnv, applyEnv } from './mapping.js';
import { createShopify } from './shopify.js';
import { createWebflow } from './webflow.js';
import { createSync } from './sync.js';
import { SyncError } from './util.js';

/**
 * env: SHOPIFY_ADMIN_TOKEN | (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET), WEBFLOW_TOKEN,
 * SHOPIFY_WEBHOOK_SECRET, and optionally SHOPIFY_DOMAIN / WEBFLOW_COLLECTION_ID to override the config file.
 */
/**
 * mode 'webhook': fail fast on long rate-limit waits (a Worker's waitUntil has ~30s).
 * budget: { left() } remaining subrequests (Worker), or null.
 */
export function createApp(rawConfig, rawEnv, { store, fetch, log, dryRun = false, sleep, mode = 'job', budget = null } = {}) {
  const env = cleanEnv(rawEnv);
  const config = normalizeConfig(applyEnv(rawConfig, env));
  const domain = config.shopify.domain;
  const collectionId = config.webflow.collectionId;
  if (!domain) throw new SyncError('Set shopify.domain in the config (or SHOPIFY_DOMAIN)');
  if (!collectionId) throw new SyncError('Set webflow.collectionId in the config (or WEBFLOW_COLLECTION_ID)');
  config.shopify.domain = domain;
  config.webflow.collectionId = collectionId;

  const shopify = createShopify({
    domain,
    adminToken: env.SHOPIFY_ADMIN_TOKEN,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET,
    apiVersion: config.shopify.apiVersion,
    metafields: config.shopify.metafields,
    inventory: config.shopify.inventory,
    tokenStore: store,
    ...(mode === 'webhook' ? { retries: 1 } : {}),
    ...(fetch ? { fetch } : {}),
    ...(sleep ? { sleep } : {}),
  });
  const webflow = createWebflow({
    token: env.WEBFLOW_TOKEN, collectionId, perMinute: config.webflow.perMinute, log,
    ...(mode === 'webhook' ? { retries: 2, maxRetryWaitMs: 10000 } : {}),
    ...(fetch ? { fetch } : {}),
    ...(sleep ? { sleep } : {}),
  });
  const sync = createSync({ config, shopify, webflow, store, log, dryRun, budget });
  return { config, shopify, webflow, sync, store, webhookSecret: env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_CLIENT_SECRET };
}
