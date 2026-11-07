/**
 * The release's rewrite of the tree to a new version, shared by `release.ts` and the `release-rehearsal` workflow, which
 * runs the gate on a pull request at the next versions: a test can fail only once package.json says a new version, and
 * the release itself no longer runs the whole gate.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseVersion } from '../server/src/release-range.ts';
import { UNRELEASED_HEADING } from './changelog.ts';
import { VERSION_COPIES, syncVersions } from './versions.ts';

const PACKAGE_VERSION = /"version": "\d+\.\d+\.\d+"/;

/** Every file `applyReleaseVersion` may change, relative to the repository root. */
export const RELEASE_FILES: readonly string[] = [
  'package.json',
  ...VERSION_COPIES.map((copy) => copy.file),
  'CHANGELOG.md',
  'README.md',
];

const RELEASE_COMMIT_FILES: ReadonlySet<string> = new Set([...RELEASE_FILES, 'package-lock.json']);

/**
 * @param file Relative to the repository root.
 * @returns Whether a release commit may change it: a file the version rewrite writes, the lockfile's copy of the
 *   version, or the rebuilt dist/.
 */
export const isReleaseCommitFile = (file: string): boolean =>
  RELEASE_COMMIT_FILES.has(file) || file.startsWith('dist/');

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
 * @returns `now`'s day in this machine's time zone, `YYYY-MM-DD`: the day the owner releases on, which in UTC can be
 *   the day before or after.
 */
export function localDate(now = new Date()): string {
  const day = (value: number) => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${day(now.getMonth() + 1)}-${day(now.getDate())}`;
}

/**
 * Sets `version` in package.json and every copy of it (`syncVersions`), turns CHANGELOG.md's `## Unreleased` notes
 * into the version's dated section under a new, empty `## Unreleased`, and moves the README's pinned examples onto it.
 *
 * @param version `X.Y.Z`.
 * @param date The release's day, `YYYY-MM-DD`.
 * @throws When `version` is not X.Y.Z, or package.json, a copy or CHANGELOG.md has nothing to replace.
 */
export async function applyReleaseVersion(root: string, version: string, date = localDate()): Promise<void> {
  const parsed = parseVersion(version);
  if (parsed?.join('.') !== version) throw new Error(`"${version}" is not X.Y.Z`);
  const [major, minor] = parsed;
  await editFile(root, 'package.json', (json) => json.replace(PACKAGE_VERSION, `"version": "${version}"`));
  await syncVersions(root);
  // The new section goes in below the heading, not in its place: a branch whose new notes start right under it then
  // conflicts with the release when it merges it, instead of adding them to the released section. Notes added further
  // down still merge in, and test/changelog.test.js fails on the section that differs from its tag.
  await editFile(root, 'CHANGELOG.md', (changelog) =>
    changelog.replace(`\n${UNRELEASED_HEADING}\n`, `\n${UNRELEASED_HEADING}\n\n## ${version} (${date})\n`),
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
