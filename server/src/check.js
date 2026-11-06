/**
 * Guided first-run check: says exactly what's missing and how to fix it.
 * Used by `tether-sync check` and the Worker's GET /check. Never returns secret values.
 *
 *   const report = await runCheck(config, env, { deep: true });
 *   report.ok, report.steps -> [{ level: 'ok' | 'warn' | 'error' | 'info', title, message, fix }]
 */
import { cleanEnv } from './env.js';
import { normalizeConfig, applyEnv } from './mapping.js';
import { messageOf, SyncError } from './util.js';
import { createSteps } from './check/steps.js';
import { checkSettings, reportIgnoredValues } from './check/settings.js';
import { checkConnections } from './check/connections.js';
import { checkTetherVersion } from './check/version.js';

/** @typedef {import('./check/steps.js').CheckStep} CheckStep */
/** @typedef {import('./check/steps.js').CheckLevel} CheckLevel */
/** @typedef {import('./mapping.js').RawConfig} RawConfig */
/** @typedef {import('./mapping.js').SyncConfig} SyncConfig */

/**
 * @typedef {object} CheckOptions
 * @property {boolean} [deep] Also call the APIs. Default true.
 * @property {typeof fetch | undefined} [fetch]
 * @property {((ms: number) => Promise<void>) | undefined} [sleep]
 * @property {boolean} [worker] Running as the Worker: customer accounts and SYNC_SECRET are checked too.
 * @property {string | null} [webhookUri] The Worker's own webhook URL: its subscriptions are checked.
 * @property {string | null} [version] The running Tether version: a newer one in `range` is reported.
 * @property {string | null} [range] TETHER_VERSION, the range the copy updates within.
 */

/**
 * The config as the check read it, without anything secret. Mapping functions show as `(function)`.
 *
 * @typedef {object} ConfigSummary
 * @property {{ domain: string | undefined, apiVersion: string, metafields: string[] }} shopify
 * @property {{ collectionId: string | undefined, publish: boolean, skipMissingFields: boolean }} webflow
 * @property {Record<string, unknown>} fields
 * @property {string[]} webflowOwned
 */

/** @typedef {{ ok: boolean, steps: CheckStep[], config?: ConfigSummary }} CheckReport */

/**
 * @param {SyncConfig} config
 * @returns {ConfigSummary}
 */
function summary(config) {
  const { shopify, webflow, fields, webflowOwned } = config;
  return {
    shopify: { domain: shopify.domain, apiVersion: shopify.apiVersion, metafields: shopify.metafields },
    webflow: {
      collectionId: webflow.collectionId,
      publish: webflow.publish,
      skipMissingFields: webflow.skipMissingFields,
    },
    fields: Object.fromEntries(
      Object.entries(fields).map(([slug, source]) => [slug, typeof source === 'function' ? '(function)' : source]),
    ),
    webflowOwned,
  };
}

/**
 * @param {RawConfig} rawConfig
 * @param {import('./env.js').CleanEnv} env
 * @returns {{ kind: 'read', config: SyncConfig } | { kind: 'invalid', problem: string, fix: string }}
 */
function readConfig(rawConfig, env) {
  try {
    return { kind: 'read', config: normalizeConfig(applyEnv(rawConfig, env)) };
  } catch (error) {
    const fieldMap = error instanceof SyncError && error.code === 'FIELD_MAP';
    return {
      kind: 'invalid',
      problem: messageOf(error),
      fix: fieldMap ? 'Fix FIELD_MAP, or set it to "none".' : 'Fix tether-sync.config.js.',
    };
  }
}

/**
 * Checks the settings, then (when `deep` and they allow it) the Shopify and Webflow connections and the Tether
 * version. Every finding is a step; nothing throws for a setup problem.
 *
 * @param {RawConfig} rawConfig
 * @param {Record<string, unknown>} rawEnv
 * @param {CheckOptions} [options]
 * @returns {Promise<CheckReport>}
 */
export async function runCheck(
  rawConfig,
  rawEnv,
  { deep = true, fetch, sleep, worker = false, webhookUri = null, version = null, range = null } = {},
) {
  const steps = createSteps();
  const env = cleanEnv(rawEnv);
  reportIgnoredValues(steps, rawEnv);
  const read = readConfig(rawConfig, env);
  if (read.kind === 'invalid') {
    steps.add('error', 'Config', read.problem, read.fix);
    return { ok: steps.ok(), steps: steps.list };
  }
  const { config } = read;
  const report = () => ({ ok: steps.ok(), steps: steps.list, config: summary(config) });

  const connection = checkSettings(steps, { config, env, rawEnv, worker, webhookUri });
  if (!deep) return report();
  if (!connection) {
    steps.add('error', 'Connections', 'Not tested: fix the items above first.');
    return report();
  }
  const network = { ...(fetch ? { fetch } : {}), ...(sleep ? { sleep } : {}) };
  await checkConnections(steps, connection, { config, env, network, webhookUri });
  if (version && connection.target.kind === 'webflow')
    await checkTetherVersion(steps, { fetch: fetch ?? globalThis.fetch, version, range });
  return report();
}

/** @type {Record<CheckLevel, string>} */
const ICONS = { ok: '✓', warn: '!', error: '✗', info: '·' };

/**
 * Human-readable lines for the CLI.
 *
 * @param {CheckReport} report
 */
export function formatCheck(report) {
  /** @type {string[]} */
  const lines = [];
  for (const step of report.steps) {
    lines.push(`${ICONS[step.level]} ${step.title}: ${step.message}`);
    if (step.fix) lines.push(`    fix: ${step.fix}`);
    if (step.sample) {
      const json = JSON.stringify(step.sample, null, 2).split('\n');
      lines.push(json.map((line) => `    ${line}`).join('\n'));
    }
  }
  const errors = report.steps.filter((step) => step.level === 'error').length;
  lines.push(
    '',
    errors
      ? `${String(errors)} thing(s) to fix before syncing.`
      : 'Ready: run `tether-sync import` (or wait for the first cron run).',
  );
  return lines.join('\n');
}
