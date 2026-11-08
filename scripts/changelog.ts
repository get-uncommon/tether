/**
 * CHANGELOG.md's sections, one `## X.Y.Z (date)` per release, newest first, and the notes of the next release, which
 * wait in `.changes/` with one file per change until the release writes them as its section (`applyReleaseVersion`).
 * Two branches never edit the same note file, so a release merged into an open branch can't move the branch's notes
 * into the released section, as a 3-way merge of one shared list of notes did. The release script also reads the
 * sections for a maintenance release, whose notes are written on its `release/X.Y` branch: main's CHANGELOG.md, the
 * one people read, gets the same section.
 */
import { compareVersions, parseVersion } from '../server/src/release-range.ts';

/** The folder, relative to the repository root, that holds the next release's note files. */
export const NOTES_FOLDER = '.changes';

/** A section's heading, named by its first word: the release's `X.Y.Z` before its date. */
const HEADING = /^## (\S+).*$/gm;
const RELEASE_HEADING = /^## \d+\.\d+\.\d+ \(\d{4}-\d{2}-\d{2}\)$/;

/** One change's note file in `NOTES_FOLDER`. */
export interface Note {
  /** The file's name, `<slug>.md`. */
  name: string;
  /** Its CHANGELOG bullets, as the file has them. */
  text: string;
}

/**
 * The order of the kinds of note in a release's section, by the first word of the file's first bullet: what a site must
 * act on first, the repository's own changes last, and every other kind (`Types:`, `Docs:`, `Sync`...) in between.
 */
const KIND_ORDER = ['Breaking', 'Security', 'Fix'];
const OTHER_KINDS = KIND_ORDER.length;
const REPOSITORY = OTHER_KINDS + 1;

/**
 * A bullet's kind, the first word after any bold: `Breaking` for `- **Breaking (npm):**`, `Fix` for `- Fix: …`. Only a
 * line that starts a bullet matches; a bullet's later lines are indented.
 */
const KIND = /^- (?:\*\*)?(\w+)/gm;

/** @returns The kind of each of the note's bullets, in its order. */
const kindsOf = (note: Note): string[] => Array.from(note.text.matchAll(KIND), (match) => match[1] ?? '');

function kindRank(note: Note): number {
  const kind = kindsOf(note)[0] ?? '';
  if (kind === 'Repository') return REPOSITORY;
  const rank = KIND_ORDER.indexOf(kind);
  return rank === -1 ? OTHER_KINDS : rank;
}

/**
 * @returns What is wrong with a note file: it holds CHANGELOG bullets of one kind, the one change's, since the release
 *   sorts the file by its first bullet's kind; and no heading of its own.
 */
export function noteProblems(note: Note): string[] {
  const problems: string[] = [];
  if (!note.name.endsWith('.md')) problems.push(`${note.name}: a note file's name ends in .md`);
  if (!note.text.startsWith('- ')) problems.push(`${note.name}: a note starts with a "- " bullet`);
  const kinds = new Set(kindsOf(note));
  if (kinds.size > 1) {
    problems.push(
      `${note.name}: a note's bullets are all one kind (it has ${[...kinds].join(', ')}): split it, one file per kind`,
    );
  }
  if (/^#/m.test(note.text)) problems.push(`${note.name}: a note has no heading; the release writes it`);
  return problems;
}

/** @returns Why a release can't be made from `notes`: none at all, or a file that isn't a note (`noteProblems`). */
export function releaseNotesProblems(notes: readonly Note[]): string[] {
  if (!notes.length) return [`no note files in ${NOTES_FOLDER}/: write one per change`];
  return notes.flatMap(noteProblems);
}

/**
 * @param notes The note files, in any order.
 * @returns The release's section: its heading, then each file's bullets, Breaking, Security and Fix notes first,
 *   Repository notes last, and within a kind by file name. A file's bullets stay together and in its order.
 */
export function releaseSection(version: string, date: string, notes: readonly Note[]): string {
  const sorted = [...notes].sort((a, b) => kindRank(a) - kindRank(b) || (a.name < b.name ? -1 : 1));
  return `## ${version} (${date})\n\n${sorted.map((note) => note.text.trim()).join('\n')}`.trimEnd();
}

/**
 * @param name A release's `X.Y.Z`.
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

/** @returns What is wrong with the headings of `changelog`: every section is a release's `## X.Y.Z (YYYY-MM-DD)`. */
export function headingProblems(changelog: string): string[] {
  const misnamed = [...changelog.matchAll(/^## .*$/gm)]
    .map(([heading]) => heading)
    .filter((heading) => !RELEASE_HEADING.test(heading));
  return misnamed.map((heading) => `"${heading}" is not "## X.Y.Z (YYYY-MM-DD)"`);
}

/**
 * @param changelog CHANGELOG.md: main's, for a maintenance release, or the release's own.
 * @param section A release's section, from its heading on (`sectionOf`, `releaseSection`).
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
