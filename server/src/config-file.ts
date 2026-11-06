/**
 * The config file as the CLI loads it (`tether-sync.config.{js,mjs,json}`): checked once, so a mistyped key fails
 * with its name instead of somewhere in a sync. Values are checked for their type only; `normalizeConfig` checks
 * what they mean.
 */

import { isRecord } from './shared/json.ts';

import type { RawConfig } from './mapping.ts';

type ValueKind = 'string' | 'number' | 'boolean' | 'string[]';

const SECTIONS: Record<string, Record<string, ValueKind>> = {
  shopify: { domain: 'string', apiVersion: 'string', metafields: 'string[]', inventory: 'boolean', query: 'string' },
  webflow: { collectionId: 'string', perMinute: 'number', publish: 'boolean', skipMissingFields: 'boolean' },
  match: { idField: 'string', bySlug: 'boolean', indexTtlMinutes: 'number' },
  reconcile: {
    maxChangesPerRun: 'number',
    maxProductsPerRun: 'number',
    maxPagesPerRun: 'number',
    reserveSubrequests: 'number',
    overlapMinutes: 'number',
    lookbackMinutes: 'number',
  },
};

const TOP_LEVEL: Record<string, ValueKind> = { webflowOwned: 'string[]', onDelete: 'string', inactive: 'string' };

function hasKind(value: unknown, kind: ValueKind): boolean {
  if (kind === 'string[]') return Array.isArray(value) && value.every((item) => typeof item === 'string');
  return typeof value === kind;
}

/** @returns The keys whose value has the wrong type, with what they should be. */
function wrongKinds(object: Record<string, unknown>, kinds: Record<string, ValueKind>, prefix: string): string[] {
  return Object.entries(kinds).flatMap(([key, kind]) =>
    object[key] === undefined || hasKind(object[key], kind) ? [] : [`${prefix}${key} must be a ${kind}`],
  );
}

/** Every problem with the config's shape; empty when it is a usable {@link RawConfig}. */
function configProblems(config: Record<string, unknown>): string[] {
  const problems = wrongKinds(config, TOP_LEVEL, '');
  for (const [name, kinds] of Object.entries(SECTIONS)) {
    const section = config[name];
    if (section === undefined) continue;
    if (isRecord(section)) problems.push(...wrongKinds(section, kinds, `${name}.`));
    else problems.push(`${name} must be an object`);
  }
  const { fields } = config;
  if (fields !== undefined && !isRecord(fields)) problems.push('fields must be an object');
  else if (fields) {
    for (const [slug, source] of Object.entries(fields))
      if (source === null) problems.push(`fields.${slug} is null: leave the field out instead`);
  }
  return problems;
}

/**
 * @param value The config module's default export, or the parsed JSON file.
 * @param path For the error message.
 * @throws {Error} Naming every key with a value of the wrong type.
 */
export function parseConfigFile(value: unknown, path: string): RawConfig {
  if (!isRecord(value)) throw new Error(`${path} must export a config object.`);
  const problems = configProblems(value);
  if (problems.length) throw new Error(`${path}: ${problems.join('; ')}.`);
  // Every key RawConfig declares was checked above; others are left for normalizeConfig to ignore.
  return value;
}
