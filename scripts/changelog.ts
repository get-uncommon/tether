/**
 * CHANGELOG.md's sections: `## Unreleased` at the top, for the notes of the next release, then one `## X.Y.Z (date)`
 * per release, which the release makes from the `## Unreleased` notes (`applyReleaseVersion`). The release script also
 * reads them for a maintenance release, whose notes are written on its `release/X.Y` branch: main's CHANGELOG.md, the
 * one people read, gets the same section.
 */
import { compareVersions, parseVersion } from '../server/src/release-range.ts';

export const UNRELEASED_HEADING = '## Unreleased';

/** A section's heading, named by its first word: `Unreleased`, or the release's `X.Y.Z` before its date. */
const HEADING = /^## (\S+).*$/gm;
const RELEASE_HEADING = /^## \d+\.\d+\.\d+ \(\d{4}-\d{2}-\d{2}\)$/;

/**
 * @param name `Unreleased`, or a release's `X.Y.Z`.
 * @returns The section `name` heads in `changelog`, from its heading up to the next one, without trailing blank lines;
 *   `null` when it has none.
 */
export function sectionOf(changelog: string, name: string): string | null {
  const headings = [...changelog.matchAll(HEADING)];
  const index = headings.findIndex((heading) => heading[1] === name);
  const start = headings[index]?.index;
  if (start === undefined) return null;
  const end = headings[index + 1]?.index ?? changelog.length;
  return changelog.slice(start, end).trimEnd();
}

/**
 * @returns What is wrong with the headings of `changelog`: the first section must be `## Unreleased`, and every other
 *   one a release's `## X.Y.Z (YYYY-MM-DD)`.
 */
export function headingProblems(changelog: string): string[] {
  const [first, ...releases] = [...changelog.matchAll(/^## .*$/gm)].map(([heading]) => heading);
  const top = first === UNRELEASED_HEADING ? [] : [`"${UNRELEASED_HEADING}" is not the first section`];
  const misnamed = releases.filter((heading) => !RELEASE_HEADING.test(heading));
  return [...top, ...misnamed.map((heading) => `"${heading}" is not "## X.Y.Z (YYYY-MM-DD)"`)];
}

/**
 * @param changelog Main's CHANGELOG.md.
 * @param section A release's section, from its heading on (`sectionOf`).
 * @returns `changelog` with `section` before the first section of an older version, or at the end when every
 *   section is newer. A changelog that already has the version's section is returned as it is.
 */
export function withSection(changelog: string, section: string, version: string): string {
  const released = parseVersion(version);
  if (!released) throw new Error(`${version} is not X.Y.Z`);
  const headings = [...changelog.matchAll(HEADING)];
  if (headings.some((heading) => heading[1] === version)) return changelog;
  const older = headings.find((heading) => {
    const listed = parseVersion(heading[1] ?? '');
    return listed !== null && compareVersions(listed, released) < 0;
  });
  if (older?.index === undefined) return `${changelog.trimEnd()}\n\n${section}\n`;
  return `${changelog.slice(0, older.index)}${section}\n\n${changelog.slice(older.index)}`;
}
