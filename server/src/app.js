/** Wires config + secrets into a sync instance. Shared by the Worker and the CLI. */
import { cleanEnv } from './env.js';
import { deployHookMinSeconds } from './settings.js';
import { normalizeConfig, applyEnv } from './mapping.js';
import { createShopify } from './shopify.js';
import { createWebflow } from './webflow.js';
import { createSync } from './sync.js';
import { SyncError, messageOf, noopLogger } from './util.js';
import {
  createDeployHook,
  deployOnlyTarget,
  withDeployHook,
  DEPLOY_FIELDS,
  DEPLOY_ONLY_COLLECTION_ID,
} from './deploy.js';

/** @typedef {import('./deploy.js').DeployHook} DeployHook */
/** @typedef {import('./deploy.js').DeployOnlyTarget} DeployOnlyTarget */
/** @typedef {import('./deploy.js').DeployOutcome} DeployOutcome */
/** @typedef {import('./env.js').CleanEnv} CleanEnv */
/** @typedef {import('./mapping.js').RawConfig} RawConfig */
/** @typedef {import('./mapping.js').SyncConfig} SyncConfig */
/** @typedef {import('./reconcile.js').Budget} Budget */
/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./sync.js').SyncEngine} SyncEngine */
/** @typedef {import('./util.js').Logger} Logger */
/** @typedef {import('./webflow.js').CmsTarget} CmsTarget */
/** @typedef {import('./webflow.js').WebflowClient} WebflowClient */

/**
 * Where product changes go. A deploy hook without a Webflow token is a statically built site that rebuilds when
 * products change.
 *
 * @typedef {{ kind: 'webflow' }
 *   | { kind: 'webflow-and-deploy', hookUrl: string }
 *   | { kind: 'deploy-only', hookUrl: string }} Destination
 */

/**
 * @typedef {object} AppOptions
 * @property {Store} store
 * @property {typeof globalThis.fetch | undefined} [fetch]
 * @property {Logger | undefined} [log]
 * @property {boolean | undefined} [dryRun]
 * @property {((ms: number) => Promise<void>) | undefined} [sleep]
 * @property {'job' | 'webhook' | undefined} [mode] `webhook` fails fast on long rate-limit waits: a Worker's waitUntil has
 *   about 30 seconds.
 * @property {Budget | null | undefined} [budget] The subrequests the Worker run has left, or `null`.
 */

/** @typedef {DeployOutcome | { error: string }} DeployReport */

/**
 * A run's result with the deploy hook's answer, which every run with a hook carries except a dry run.
 *
 * @template R
 * @typedef {R & { deploy?: DeployReport }} WithDeploy
 */

/**
 * @typedef {Omit<SyncEngine, 'syncById' | 'removeProduct' | 'reconcile' | 'importAll'> & {
 *   syncById: (id: string | number) => Promise<WithDeploy<import('./sync-product.js').SyncResult>>,
 *   removeProduct: (id: string | number) => Promise<WithDeploy<import('./sync-product.js').SyncResult>>,
 *   reconcile: (options?: import('./reconcile.js').ReconcileOptions) =>
 *     Promise<WithDeploy<import('./reconcile.js').ReconcileResult>>,
 *   importAll: (options?: import('./sync.js').ImportOptions) => Promise<WithDeploy<import('./sync.js').ImportResult>>,
 * }} AppSync
 */
/** Webhook runs live inside a Worker's waitUntil: few retries, and no waiting out a long Retry-After. */
const WEBHOOK_SHOPIFY_RETRIES = 1;
const WEBHOOK_WEBFLOW = { retries: 2, maxRetryWaitMs: 10000 };

/** @param {CleanEnv} env @returns {Destination} */
function destinationFrom(env) {
  const hookUrl = env.DEPLOY_HOOK_URL;
  if (!hookUrl) return { kind: 'webflow' };
  return env.WEBFLOW_TOKEN ? { kind: 'webflow-and-deploy', hookUrl } : { kind: 'deploy-only', hookUrl };
}

/**
 * The config file, with the deploy-only mapping when there is no Webflow: the default fields of a static product
 * page (unless FIELD_MAP says otherwise), nothing Webflow-owned, and no collection to check fields against.
 *
 * @param {RawConfig} rawConfig
 * @param {CleanEnv} env
 * @param {Destination} destination
 * @returns {RawConfig}
 */
function configFor(rawConfig, env, destination) {
  if (destination.kind !== 'deploy-only') return rawConfig;
  return {
    ...rawConfig,
    fields: env.FIELD_MAP ? (rawConfig.fields ?? {}) : DEPLOY_FIELDS,
    webflowOwned: [],
    webflow: { ...(rawConfig.webflow ?? {}), collectionId: DEPLOY_ONLY_COLLECTION_ID, skipMissingFields: false },
  };
}

/**
 * @param {DeployHook} hook
 * @param {Logger} log
 * @returns {Promise<DeployReport>}
 */
async function triggerReport(hook, log) {
  try {
    return await hook.maybeTrigger();
  } catch (err) {
    log.error(`deploy hook: ${messageOf(err)}`);
    return { error: messageOf(err) };
  }
}

/**
 * The engine, with a build started after every run that changed products.
 *
 * @param {SyncEngine} engine
 * @param {DeployHook} hook
 * @param {Logger} log
 * @param {boolean} dryRun
 * @returns {AppSync}
 */
function withBuildAfterRuns(engine, hook, log, dryRun) {
  /**
   * @template {unknown[]} A
   * @template {object} R
   * @param {(...args: A) => Promise<R>} run
   * @returns {(...args: A) => Promise<WithDeploy<R>>}
   */
  const thenBuild =
    (run) =>
    async (...args) => {
      const result = await run(...args);
      if (dryRun) return result;
      return Object.assign(result, { deploy: await triggerReport(hook, log) });
    };
  return {
    ...engine,
    syncById: thenBuild(engine.syncById),
    removeProduct: thenBuild(engine.removeProduct),
    reconcile: thenBuild(engine.reconcile),
    importAll: thenBuild(engine.importAll),
  };
}

/**
 * The CMS target the engine writes to, and the deploy hook that runs after it.
 *
 * @param {Destination} destination
 * @param {(url: string) => DeployHook} hookFor
 * @param {() => WebflowClient} webflowClient
 * @returns {{ webflow: WebflowClient | DeployOnlyTarget, deploy: DeployHook | null }}
 */
function targetFor(destination, hookFor, webflowClient) {
  switch (destination.kind) {
    case 'webflow':
      return { webflow: webflowClient(), deploy: null };
    case 'webflow-and-deploy': {
      const hook = hookFor(destination.hookUrl);
      return { webflow: withDeployHook(webflowClient(), hook), deploy: hook };
    }
    case 'deploy-only': {
      const hook = hookFor(destination.hookUrl);
      return { webflow: deployOnlyTarget(hook), deploy: hook };
    }
  }
}

/**
 * @typedef {object} App
 * @property {SyncConfig & { shopify: { domain: string } }} config The domain is always set.
 * @property {ReturnType<typeof createShopify>} shopify
 * @property {WebflowClient | DeployOnlyTarget} webflow
 * @property {AppSync} sync
 * @property {Store} store
 * @property {DeployHook | null} deploy
 * @property {boolean} deployOnly
 * @property {string[]} webhookSecrets Keys a product webhook may be signed with.
 */

/**
 * env: SHOPIFY_ADMIN_TOKEN | (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET), WEBFLOW_TOKEN, SHOPIFY_WEBHOOK_SECRET, and
 * optionally SHOPIFY_DOMAIN / WEBFLOW_COLLECTION_ID to override the config file, DEPLOY_HOOK_URL and
 * DEPLOY_HOOK_MIN_SECONDS for a statically built site.
 *
 * @param {RawConfig} rawConfig
 * @param {Record<string, unknown>} rawEnv
 * @param {AppOptions} options
 * @returns {App}
 * @throws {SyncError} When the store domain, the collection or a credential is missing, or the config is invalid.
 */
export function createApp(
  rawConfig,
  rawEnv,
  { store, fetch, log = noopLogger, dryRun = false, sleep, mode = 'job', budget = null },
) {
  const env = cleanEnv(rawEnv);
  const destination = destinationFrom(env);
  const config = normalizeConfig(applyEnv(configFor(rawConfig, env, destination), env));
  const domain = config.shopify.domain;
  const collectionId = config.webflow.collectionId;
  if (!domain) throw new SyncError('Set shopify.domain in the config (or SHOPIFY_DOMAIN)');
  if (!collectionId)
    throw new SyncError(
      'Set webflow.collectionId in the config (or WEBFLOW_COLLECTION_ID), or DEPLOY_HOOK_URL for a statically built site',
    );
  const transport = { ...(fetch ? { fetch } : {}), ...(sleep ? { sleep } : {}) };

  const shopify = createShopify({
    domain,
    adminToken: env.SHOPIFY_ADMIN_TOKEN,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET,
    apiVersion: config.shopify.apiVersion,
    metafields: config.shopify.metafields,
    inventory: config.shopify.inventory,
    tokenStore: store,
    ...(mode === 'webhook' ? { retries: WEBHOOK_SHOPIFY_RETRIES } : {}),
    ...transport,
  });
  /** @param {string} url */
  const hookFor = (url) =>
    createDeployHook({
      url,
      minIntervalSeconds: deployHookMinSeconds(env),
      store,
      log,
      ...(fetch ? { fetch } : {}),
    });
  const webflowClient = () =>
    createWebflow({
      token: env.WEBFLOW_TOKEN,
      collectionId,
      perMinute: config.webflow.perMinute,
      log,
      ...(mode === 'webhook' ? WEBHOOK_WEBFLOW : {}),
      ...transport,
    });
  const { webflow, deploy } = targetFor(destination, hookFor, webflowClient);
  const engine = createSync({ config, shopify, webflow, store, log, dryRun, budget });
  // App-registered webhooks are signed with the client secret, admin-created ones with their own key.
  const webhookSecrets = [env.SHOPIFY_WEBHOOK_SECRET, env.SHOPIFY_CLIENT_SECRET].filter(
    (secret) => secret !== undefined,
  );
  return {
    config: { ...config, shopify: { ...config.shopify, domain } },
    shopify,
    webflow,
    sync: deploy ? withBuildAfterRuns(engine, deploy, log, dryRun) : engine,
    store,
    deploy,
    deployOnly: destination.kind === 'deploy-only',
    webhookSecrets,
  };
}
