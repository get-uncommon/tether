/**
 * CHANGELOG.md's release sections, for the release script: a maintenance release's notes are written on its
 * `release/X.Y` branch, and main's CHANGELOG.md, the one people read, gets the same section.
 */
import { compareVersions, parseVersion } from '../server/src/release-range.ts';

/** A release section's heading: `## X.Y.Z`, followed by its date or `(unreleased)`. */
const HEADING = /^## (\d+\.\d+\.\d+)(?: .*)?$/gm;

/**
 * @returns The section of `version` in `changelog`, from its heading up to the next one, without trailing blank
 *   lines; `null` when it has none.
 */
export function sectionOf(changelog: string, version: string): string | null {
  const headings = [...changelog.matchAll(HEADING)];
  const index = headings.findIndex((heading) => heading[1] === version);
  const start = headings[index]?.index;
  if (start === undefined) return null;
  const end = headings[index + 1]?.index ?? changelog.length;
  return changelog.slice(start, end).trimEnd();
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
