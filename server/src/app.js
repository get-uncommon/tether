/** Wires config + secrets into a sync instance. Shared by the Worker and the CLI. */
import { normalizeConfig } from './mapping.js';
import { createShopify } from './shopify.js';
import { createWebflow } from './webflow.js';
import { createSync } from './sync.js';
import { SyncError } from './util.js';

/**
 * env: SHOPIFY_ADMIN_TOKEN | (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET), WEBFLOW_TOKEN,
 * SHOPIFY_WEBHOOK_SECRET, and optionally SHOPIFY_DOMAIN / WEBFLOW_COLLECTION_ID to override the config file.
 */
export function createApp(rawConfig, env, { store, fetch, log, dryRun = false, sleep } = {}) {
  const config = normalizeConfig(rawConfig);
  const domain = env.SHOPIFY_DOMAIN || config.shopify.domain;
  const collectionId = env.WEBFLOW_COLLECTION_ID || config.webflow.collectionId;
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
    ...(fetch ? { fetch } : {}),
    ...(sleep ? { sleep } : {}),
  });
  const webflow = createWebflow({
    token: env.WEBFLOW_TOKEN, collectionId, perMinute: config.webflow.perMinute, log,
    ...(fetch ? { fetch } : {}),
    ...(sleep ? { sleep } : {}),
  });
  const sync = createSync({ config, shopify, webflow, store, log, dryRun });
  return { config, shopify, webflow, sync, webhookSecret: env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_CLIENT_SECRET };
}
