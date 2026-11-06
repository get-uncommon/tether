/**
 * Guided first-run check: says exactly what's missing and how to fix it.
 * Used by `tether-sync check` and the Worker's GET /check. Never returns secret values.
 *
 *   const report = await runCheck(config, env, { deep: true });
 *   report.ok, report.steps -> [{ level: 'ok' | 'warn' | 'error' | 'info', title, message, fix }]
 */
import { cleanEnv } from './env.ts';
import { normalizeConfig, applyEnv } from './mapping.ts';
import { messageOf, SyncError } from './util.ts';
import { createSteps } from './check/steps.ts';
import { checkSettings, reportIgnoredValues } from './check/settings.ts';
import { checkConnections } from './check/connections.ts';
import { checkTetherVersion } from './check/version.ts';
import type { CheckLevel, CheckStep } from './check/steps.ts';
import type { CleanEnv } from './env.ts';
import type { RawConfig, SyncConfig } from './mapping.ts';

interface CheckOptions {
  /** Also call the APIs. Default true. */
  deep?: boolean;
  fetch?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Running as the Worker: customer accounts and SYNC_SECRET are checked too. */
  worker?: boolean;
  /** The Worker's own webhook URL: its subscriptions are checked. */
  webhookUri?: string | null;
  /** The running Tether version: a newer one in `range` is reported. */
  version?: string | null;
  /** TETHER_VERSION, the range the copy updates within. */
  range?: string | null;
}

/** The config as the check read it, without anything secret. Mapping functions show as `(function)`. */
interface ConfigSummary {
  shopify: { domain: string | undefined; apiVersion: string; metafields: string[] };
  webflow: { collectionId: string | undefined; publish: boolean; skipMissingFields: boolean };
  fields: Record<string, unknown>;
  webflowOwned: string[];
}

interface CheckReport {
  ok: boolean;
  steps: CheckStep[];
  config?: ConfigSummary;
}

function summary(config: SyncConfig): ConfigSummary {
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

function readConfig(
  rawConfig: RawConfig,
  env: CleanEnv,
): { kind: 'read'; config: SyncConfig } | { kind: 'invalid'; problem: string; fix: string } {
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
 */
export async function runCheck(
  rawConfig: RawConfig,
  rawEnv: Record<string, unknown>,
  { deep = true, fetch, sleep, worker = false, webhookUri = null, version = null, range = null }: CheckOptions = {},
): Promise<CheckReport> {
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
  // Both targets are deployed copies that the weekly updater keeps current, so both show a stalled update.
  if (version) await checkTetherVersion(steps, { fetch: fetch ?? globalThis.fetch, version, range });
  return report();
}

const ICONS: Record<CheckLevel, string> = { ok: '✓', warn: '!', error: '✗', info: '·' };

/** Human-readable lines for the CLI. */
export function formatCheck(report: CheckReport): string {
  const lines: string[] = [];
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
