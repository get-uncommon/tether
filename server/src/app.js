/** Wires config + secrets into a sync instance. Shared by the Worker and the CLI. */
import { normalizeConfig, cleanEnv, applyEnv } from './mapping.js';
import { createShopify } from './shopify.js';
import { createWebflow } from './webflow.js';
import { createSync } from './sync.js';
import { SyncError } from './util.js';
import { createDeployHook, deployOnlyTarget, withDeployHook, DEPLOY_FIELDS } from './deploy.js';

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
  // No Webflow, only a deploy hook: a statically built site that rebuilds when products change.
  const deployOnly = Boolean(env.DEPLOY_HOOK_URL) && !env.WEBFLOW_TOKEN;
  const raw = deployOnly
    ? { ...rawConfig, fields: env.FIELD_MAP ? rawConfig.fields : DEPLOY_FIELDS, webflowOwned: [], webflow: { ...(rawConfig.webflow || {}), collectionId: 'deploy-hook', skipMissingFields: false } }
    : rawConfig;
  const config = normalizeConfig(applyEnv(raw, env));
  const domain = config.shopify.domain;
  const collectionId = config.webflow.collectionId;
  if (!domain) throw new SyncError('Set shopify.domain in the config (or SHOPIFY_DOMAIN)');
  if (!collectionId) throw new SyncError('Set webflow.collectionId in the config (or WEBFLOW_COLLECTION_ID), or DEPLOY_HOOK_URL for a statically built site');
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
  const deploy = env.DEPLOY_HOOK_URL
    ? createDeployHook({ url: env.DEPLOY_HOOK_URL, minIntervalSeconds: env.DEPLOY_HOOK_MIN_SECONDS !== undefined && !Number.isNaN(Number(env.DEPLOY_HOOK_MIN_SECONDS)) ? Number(env.DEPLOY_HOOK_MIN_SECONDS) : 60, store, log, ...(fetch ? { fetch } : {}) })
    : null;
  let webflow = deployOnly ? deployOnlyTarget(deploy) : createWebflow({
    token: env.WEBFLOW_TOKEN, collectionId, perMinute: config.webflow.perMinute, log,
    ...(mode === 'webhook' ? { retries: 2, maxRetryWaitMs: 10000 } : {}),
    ...(fetch ? { fetch } : {}),
    ...(sleep ? { sleep } : {}),
  });
  if (deploy && !deployOnly) webflow = withDeployHook(webflow, deploy);
  const engine = createSync({ config, shopify, webflow, store, log, dryRun, budget });
  // After every run: start a build if products changed (deploy hook only).
  const after = (fn) => async (...args) => {
    const result = await fn(...args);
    if (deploy && !dryRun) {
      try { result.deploy = await deploy.maybeTrigger(); } catch (err) { log?.error?.(`deploy hook: ${err.message}`); if (result && typeof result === 'object') result.deploy = { error: err.message }; }
    }
    return result;
  };
  const sync = deploy
    ? { ...engine, syncById: after(engine.syncById), removeProduct: after(engine.removeProduct), reconcile: after(engine.reconcile), importAll: after(engine.importAll) }
    : engine;
  // App-registered webhooks are signed with the client secret, admin-created ones with their own key.
  const webhookSecrets = [env.SHOPIFY_WEBHOOK_SECRET, env.SHOPIFY_CLIENT_SECRET].filter(Boolean);
  return { config, shopify, webflow, sync, store, deploy, deployOnly, webhookSecret: webhookSecrets[0], webhookSecrets };
}
