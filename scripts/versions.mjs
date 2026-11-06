/**
 * The package version is written in one place, the root package.json. The copies the code reads at run time (the
 * browser script's `VERSION`, the Worker's, which runs from source without the root package.json, and the Worker's
 * own package.json) are written from it here, by the release script; a test checks they agree.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const VERSION_CONSTANT = /export const VERSION = '[^']*';/;
const PACKAGE_VERSION = /"version": "[^"]*"/;

/**
 * @typedef {object} VersionCopy
 * @property {string} file Relative to the repository root.
 * @property {RegExp} pattern Matches the version as written in it.
 * @property {(version: string) => string} written The text `pattern` matches, for `version`.
 */

/** @type {readonly VersionCopy[]} */
export const VERSION_COPIES = [
  { file: 'server/package.json', pattern: PACKAGE_VERSION, written: (version) => `"version": "${version}"` },
  { file: 'src/index.js', pattern: VERSION_CONSTANT, written: (version) => `export const VERSION = '${version}';` },
  {
    file: 'server/src/version.js',
    pattern: VERSION_CONSTANT,
    written: (version) => `export const VERSION = '${version}';`,
  },
  {
    // The update range of new Worker copies: every patch of this minor version, never the next minor on its own.
    file: 'server/TETHER_VERSION',
    pattern: /^(latest|\d+\.\d+(\.\d+)?)$/m,
    written: (version) => version.split('.').slice(0, 2).join('.'),
  },
];

/**
 * @param {string} root The repository root.
 * @returns {Promise<string>} The version in the root package.json.
 * @throws {Error} When it has none.
 */
export async function packageVersion(root) {
  /** @type {unknown} */
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  /** @type {unknown} */
  const version = typeof pkg === 'object' && pkg !== null ? Reflect.get(pkg, 'version') : undefined;
  if (typeof version !== 'string' || !version) throw new Error('package.json has no version');
  return version;
}

/**
 * @param {string} root
 * @returns {Promise<string[]>} The copies that don't say the package.json version, each as `file: what it says`.
 */
export async function versionMismatches(root) {
  const version = await packageVersion(root);
  /** @type {string[]} */
  const mismatches = [];
  for (const copy of VERSION_COPIES) {
    const text = await readFile(join(root, copy.file), 'utf8');
    const found = copy.pattern.exec(text)?.[0] ?? 'no version';
    if (found !== copy.written(version)) mismatches.push(`${copy.file}: ${found}`);
  }
  return mismatches;
}

/**
 * Writes the package.json version into every copy.
 *
 * @param {string} root
 * @returns {Promise<string>} The version written.
 * @throws {Error} When a copy has no version to replace, so a moved constant can't be skipped unnoticed.
 */
export async function syncVersions(root) {
  const version = await packageVersion(root);
  for (const copy of VERSION_COPIES) {
    const path = join(root, copy.file);
    const text = await readFile(path, 'utf8');
    if (!copy.pattern.test(text)) throw new Error(`${copy.file}: no version to replace`);
    await writeFile(path, text.replace(copy.pattern, copy.written(version)));
  }
  return version;
}
