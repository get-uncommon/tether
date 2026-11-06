/**
 * The package version is written in one place, the root package.json. The copies the code reads at run time (the
 * browser script's `VERSION`, the Worker's, which runs from source without the root package.json, and the Worker's
 * own package.json) are written from it here, by the release script; a test checks they agree.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const VERSION_CONSTANT = /export const VERSION = '[^']*';/;
const PACKAGE_VERSION = /"version": "[^"]*"/;

interface VersionCopy {
  /** Relative to the repository root. */
  file: string;
  /** Matches the version as written in it. */
  pattern: RegExp;
  /** The text `pattern` matches, for `version`. */
  written: (version: string) => string;
}

export const VERSION_COPIES: readonly VersionCopy[] = [
  { file: 'server/package.json', pattern: PACKAGE_VERSION, written: (version) => `"version": "${version}"` },
  { file: 'src/index.ts', pattern: VERSION_CONSTANT, written: (version) => `export const VERSION = '${version}';` },
  {
    file: 'server/src/version.ts',
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
 * @param root The repository root.
 * @returns The version in the root package.json.
 * @throws When it has none.
 */
export async function packageVersion(root: string): Promise<string> {
  const pkg: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const version: unknown = typeof pkg === 'object' && pkg !== null ? Reflect.get(pkg, 'version') : undefined;
  if (typeof version !== 'string' || !version) throw new Error('package.json has no version');
  return version;
}

/** @returns The copies that don't say the package.json version, each as `file: what it says`. */
export async function versionMismatches(root: string): Promise<string[]> {
  const version = await packageVersion(root);
  const mismatches: string[] = [];
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
 * @returns The version written.
 * @throws When a copy has no version to replace, so a moved constant can't be skipped unnoticed.
 */
export async function syncVersions(root: string): Promise<string> {
  const version = await packageVersion(root);
  for (const copy of VERSION_COPIES) {
    const path = join(root, copy.file);
    const text = await readFile(path, 'utf8');
    if (!copy.pattern.test(text)) throw new Error(`${copy.file}: no version to replace`);
    await writeFile(path, text.replace(copy.pattern, copy.written(version)));
  }
  return version;
}
