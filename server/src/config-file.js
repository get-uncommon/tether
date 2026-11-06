/**
 * The config file as the CLI loads it (`tether-sync.config.{js,mjs,json}`): checked once, so a mistyped key fails
 * with its name instead of somewhere in a sync. Values are checked for their type only; `normalizeConfig` checks
 * what they mean.
 */

import { isPlainObject } from './json.js';

/** @typedef {import('./mapping.js').RawConfig} RawConfig */

/** @typedef {'string' | 'number' | 'boolean' | 'string[]'} ValueKind */

/** @type {Record<string, Record<string, ValueKind>>} */
const SECTIONS = {
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

/** @type {Record<string, ValueKind>} */
const TOP_LEVEL = { webflowOwned: 'string[]', onDelete: 'string', inactive: 'string' };

/**
 * @param {unknown} value
 * @param {ValueKind} kind
 */
function hasKind(value, kind) {
  if (kind === 'string[]') return Array.isArray(value) && value.every((item) => typeof item === 'string');
  return typeof value === kind;
}

/**
 * @param {Record<string, unknown>} object
 * @param {Record<string, ValueKind>} kinds
 * @param {string} prefix
 * @returns {string[]} The keys whose value has the wrong type, with what they should be.
 */
function wrongKinds(object, kinds, prefix) {
  return Object.entries(kinds).flatMap(([key, kind]) =>
    object[key] === undefined || hasKind(object[key], kind) ? [] : [`${prefix}${key} must be a ${kind}`],
  );
}

/**
 * Every problem with the config's shape; empty when it is a usable {@link RawConfig}.
 *
 * @param {Record<string, unknown>} config
 * @returns {string[]}
 */
function configProblems(config) {
  const problems = wrongKinds(config, TOP_LEVEL, '');
  for (const [name, kinds] of Object.entries(SECTIONS)) {
    const section = config[name];
    if (section === undefined) continue;
    if (isPlainObject(section)) problems.push(...wrongKinds(section, kinds, `${name}.`));
    else problems.push(`${name} must be an object`);
  }
  const { fields } = config;
  if (fields !== undefined && !isPlainObject(fields)) problems.push('fields must be an object');
  else if (fields) {
    for (const [slug, source] of Object.entries(fields))
      if (source === null) problems.push(`fields.${slug} is null: leave the field out instead`);
  }
  return problems;
}

/**
 * @param {unknown} value The config module's default export, or the parsed JSON file.
 * @param {string} path For the error message.
 * @returns {RawConfig}
 * @throws {Error} Naming every key with a value of the wrong type.
 */
export function parseConfigFile(value, path) {
  if (!isPlainObject(value)) throw new Error(`${path} must export a config object.`);
  const problems = configProblems(value);
  if (problems.length) throw new Error(`${path}: ${problems.join('; ')}.`);
  // Every key RawConfig declares was checked above; others are left for normalizeConfig to ignore.
  return /** @type {RawConfig} */ (value);
}
