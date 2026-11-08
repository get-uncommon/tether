/**
 * Whether node_modules holds what package-lock.json locks, read from npm's hidden lockfile,
 * `node_modules/.package-lock.json`, which npm writes on every install with the tree it installed. The release checks
 * it first: its commit runs the pre-commit hook's linters from node_modules.
 */
import { field, isRecord, textOrNull } from '../server/src/shared/json.ts';

const MODULES = 'node_modules/';

/**
 * @param locked package-lock.json, parsed.
 * @param installed `node_modules/.package-lock.json`, parsed, or `null` when there is none.
 * @returns Each locked package that isn't installed at its locked version, as a phrase naming it, in the lockfile's
 *   order. An optional package is skipped: npm leaves one out on a platform it isn't for.
 */
export function installMismatches(locked: unknown, installed: unknown): string[] {
  const lockedPackages = field(locked, 'packages');
  if (!isRecord(lockedPackages)) return ['package-lock.json lists no packages'];
  const installedPackages = field(installed, 'packages');
  const mismatches: string[] = [];
  for (const [path, entry] of Object.entries(lockedPackages)) {
    // "" is the project itself.
    if (!path.startsWith(MODULES) || field(entry, 'optional') === true) continue;
    const name = path.slice(MODULES.length);
    const want = textOrNull(field(entry, 'version'));
    const have = textOrNull(field(field(installedPackages, path), 'version'));
    if (have === null) mismatches.push(`${name} is not installed`);
    else if (have !== want) mismatches.push(`${name} is ${have}, locked at ${String(want)}`);
  }
  return mismatches;
}
