/**
 * The release's rewrite of the tree to a new version, shared by `release.ts` and the `release-rehearsal` workflow, which
 * runs the gate on a pull request at the next versions: a test can fail only once package.json says a new version, and
 * the release itself no longer runs the whole gate.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseVersion } from '../server/src/release-range.ts';
import { VERSION_COPIES, syncVersions } from './versions.ts';

const PACKAGE_VERSION = /"version": "\d+\.\d+\.\d+"/;

/** Every file `applyReleaseVersion` may change, relative to the repository root. */
export const RELEASE_FILES: readonly string[] = [
  'package.json',
  ...VERSION_COPIES.map((copy) => copy.file),
  'CHANGELOG.md',
  'README.md',
];

/**
 * Rewrites `file` with `change`.
 *
 * @param file Relative to `root`.
 * @throws When nothing changed, unless `optional`.
 */
export async function editFile(
  root: string,
  file: string,
  change: (text: string) => string,
  { optional = false } = {},
): Promise<void> {
  const path = join(root, file);
  const before = await readFile(path, 'utf8');
  const after = change(before);
  if (after === before && !optional) throw new Error(`${file}: nothing to change (pattern not found?)`);
  await writeFile(path, after);
}

/**
 * Sets `version` in package.json and every copy of it (`syncVersions`), dates its CHANGELOG.md heading when it is
 * `## X.Y.Z (unreleased)`, and moves the README's pinned examples onto it.
 *
 * @param version `X.Y.Z`.
 * @param date The release's day, `YYYY-MM-DD`.
 * @throws When `version` is not X.Y.Z, or package.json or a copy has no version to replace.
 */
export async function applyReleaseVersion(
  root: string,
  version: string,
  date = new Date().toISOString().slice(0, 10),
): Promise<void> {
  const parsed = parseVersion(version);
  if (parsed?.join('.') !== version) throw new Error(`"${version}" is not X.Y.Z`);
  const [major, minor] = parsed;
  await editFile(root, 'package.json', (json) => json.replace(PACKAGE_VERSION, `"version": "${version}"`));
  await syncVersions(root);
  await editFile(
    root,
    'CHANGELOG.md',
    (changelog) => changelog.replace(`\n## ${version} (unreleased)\n`, `\n## ${version} (${date})\n`),
    { optional: true },
  );
  // Ranges like @0.3 follow the minor version.
  await editFile(
    root,
    'README.md',
    (readme) =>
      readme
        .replace(/@v\d+\.\d+\.\d+/g, `@v${version}`)
        .replace(/@\d+\.\d+\/dist/g, `@${String(major)}.${String(minor)}/dist`)
        .replace(
          /`@\d+\.\d+` gets every \d+\.\d+\.x fix/,
          `\`@${String(major)}.${String(minor)}\` gets every ${String(major)}.${String(minor)}.x fix`,
        ),
    { optional: true },
  );
}
