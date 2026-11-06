/** Wires config + secrets into a sync instance. Shared by the Worker and the CLI. */
import { cleanEnv } from './env.ts';
import { deployHookMinSeconds } from './settings.ts';
import { normalizeConfig, applyEnv } from './mapping.ts';
import { createShopify } from './shopify.ts';
import { createWebflow } from './webflow.ts';
import { createSync } from './sync.ts';
import { SyncError, messageOf, noopLogger } from './util.ts';
import {
  createDeployHook,
  deployOnlyTarget,
  withDeployHook,
  DEPLOY_FIELDS,
  DEPLOY_ONLY_COLLECTION_ID,
} from './deploy.ts';

import type { DeployHook, DeployOnlyTarget, DeployOutcome } from './deploy.ts';
import type { CleanEnv } from './env.ts';
import type { RawConfig, SyncConfig } from './mapping.ts';
import type { Budget, ReconcileOptions, ReconcileResult } from './reconcile.ts';
import type { ShopifyClient } from './shopify.ts';
import type { Store } from './store.ts';
import type { SyncResult } from './sync-product.ts';
import type { ImportOptions, ImportResult, SyncEngine } from './sync.ts';
import type { Logger } from './util.ts';
import type { WebflowClient } from './webflow.ts';

/**
 * Where product changes go. A deploy hook without a Webflow token is a statically built site that rebuilds when
 * products change.
 */
type Destination =
  { kind: 'webflow' } | { kind: 'webflow-and-deploy'; hookUrl: string } | { kind: 'deploy-only'; hookUrl: string };

interface AppOptions {
  store: Store;
  fetch?: typeof globalThis.fetch | undefined;
  log?: Logger | undefined;
  dryRun?: boolean | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** `webhook` fails fast on long rate-limit waits: a Worker's waitUntil has about 30 seconds. */
  mode?: 'job' | 'webhook' | undefined;
  /** The subrequests the Worker run has left, or `null`. */
  budget?: Budget | null | undefined;
}

type DeployReport = DeployOutcome | { error: string };

/** A run's result with the deploy hook's answer, which every run with a hook carries except a dry run. */
type WithDeploy<R> = R & { deploy?: DeployReport | undefined };

type AppSync = Omit<SyncEngine, 'syncById' | 'removeProduct' | 'reconcile' | 'importAll'> & {
  syncById: (id: string | number) => Promise<WithDeploy<SyncResult>>;
  removeProduct: (id: string | number) => Promise<WithDeploy<SyncResult>>;
  reconcile: (options?: ReconcileOptions) => Promise<WithDeploy<ReconcileResult>>;
  importAll: (options?: ImportOptions) => Promise<WithDeploy<ImportResult>>;
};

/** Webhook runs live inside a Worker's waitUntil: few retries, and no waiting out a long Retry-After. */
const WEBHOOK_SHOPIFY_RETRIES = 1;
const WEBHOOK_WEBFLOW = { retries: 2, maxRetryWaitMs: 10000 };

function destinationFrom(env: CleanEnv): Destination {
  const hookUrl = env.DEPLOY_HOOK_URL;
  if (!hookUrl) return { kind: 'webflow' };
  return env.WEBFLOW_TOKEN ? { kind: 'webflow-and-deploy', hookUrl } : { kind: 'deploy-only', hookUrl };
}

/**
 * The config file, with the deploy-only mapping when there is no Webflow: the default fields of a static product
 * page (unless FIELD_MAP says otherwise), nothing Webflow-owned, and no collection to check fields against.
 */
function configFor(rawConfig: RawConfig, env: CleanEnv, destination: Destination): RawConfig {
  if (destination.kind !== 'deploy-only') return rawConfig;
  return {
    ...rawConfig,
    fields: env.FIELD_MAP ? (rawConfig.fields ?? {}) : DEPLOY_FIELDS,
    webflowOwned: [],
    webflow: { ...(rawConfig.webflow ?? {}), collectionId: DEPLOY_ONLY_COLLECTION_ID, skipMissingFields: false },
  };
}

async function triggerReport(hook: DeployHook, log: Logger): Promise<DeployReport> {
  try {
    return await hook.maybeTrigger();
  } catch (err) {
    log.error(`deploy hook: ${messageOf(err)}`);
    return { error: messageOf(err) };
  }
}

/** The engine, with a build started after every run that changed products. */
function withBuildAfterRuns(engine: SyncEngine, hook: DeployHook, log: Logger, dryRun: boolean): AppSync {
  const thenBuild =
    <A extends unknown[], R extends object>(run: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<WithDeploy<R>> => {
      const result = await run(...args);
      const report = dryRun ? {} : { deploy: await triggerReport(hook, log) };
      return Object.assign(result, report);
    };
  return {
    ...engine,
    syncById: thenBuild(engine.syncById),
    removeProduct: thenBuild(engine.removeProduct),
    reconcile: thenBuild(engine.reconcile),
    importAll: thenBuild(engine.importAll),
  };
}

/** The CMS target the engine writes to, and the deploy hook that runs after it. */
function targetFor(
  destination: Destination,
  hookFor: (url: string) => DeployHook,
  webflowClient: () => WebflowClient,
): { webflow: WebflowClient | DeployOnlyTarget; deploy: DeployHook | null } {
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

export interface App {
  /** The domain is always set. */
  config: SyncConfig & { shopify: { domain: string } };
  shopify: ShopifyClient;
  webflow: WebflowClient | DeployOnlyTarget;
  sync: AppSync;
  store: Store;
  deploy: DeployHook | null;
  deployOnly: boolean;
  /** Keys a product webhook may be signed with. */
  webhookSecrets: string[];
}

/**
 * env: SHOPIFY_ADMIN_TOKEN | (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET), WEBFLOW_TOKEN, SHOPIFY_WEBHOOK_SECRET, and
 * optionally SHOPIFY_DOMAIN / WEBFLOW_COLLECTION_ID to override the config file, DEPLOY_HOOK_URL and
 * DEPLOY_HOOK_MIN_SECONDS for a statically built site.
 *
 * @throws {SyncError} When the store domain, the collection or a credential is missing, or the config is invalid.
 */
export function createApp(
  rawConfig: RawConfig,
  rawEnv: Record<string, unknown>,
  { store, fetch, log = noopLogger, dryRun = false, sleep, mode = 'job', budget = null }: AppOptions,
): App {
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
  const hookFor = (url: string) =>
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
