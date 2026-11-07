/**
 * The release's rewrite of the tree to a new version, shared by `release.ts` and the `release-rehearsal` workflow, which
 * runs the gate on a pull request at the next versions: a test can fail only once package.json says a new version, and
 * the release itself no longer runs the whole gate.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseVersion } from '../server/src/release-range.ts';
import { NOTES_FOLDER, noteProblems, releaseSection, withSection } from './changelog.ts';
import type { Note } from './changelog.ts';
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

/** A file a commit, or the working tree, changes, and whether it is deleted. */
export interface FileChange {
  /** Relative to the repository root. */
  path: string;
  deleted: boolean;
}

/**
 * @param nameStatus What `git diff --name-status --no-renames -z` prints: each status and path ends in a NUL, and a
 *   path is as it is, where without `-z` git quotes one with a byte outside ASCII (core.quotePath).
 */
export function fileChanges(nameStatus: string): FileChange[] {
  const fields = nameStatus.split('\0');
  const changes: FileChange[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [status, path] = fields.slice(i, i + 2);
    if (path !== undefined) changes.push({ path, deleted: status === 'D' });
  }
  return changes;
}

/**
 * @param file Relative to the repository root.
 * @param deleted Whether the commit deletes it.
 * @returns Whether a release commit may make that change: to a file the version rewrite writes, the lockfile's copy of
 *   the version, or the rebuilt dist/, or the deletion of a note file the release wrote into CHANGELOG.md.
 */
export const isReleaseCommitChange = (file: string, deleted: boolean): boolean =>
  RELEASE_COMMIT_FILES.has(file) || file.startsWith('dist/') || (deleted && file.startsWith(`${NOTES_FOLDER}/`));

/**
 * @returns The note files in `root`'s `NOTES_FOLDER`, with LF line ends even where core.autocrlf gave them CRLF; none
 *   when it has no such folder. Folders and dotfiles (the `.DS_Store` Finder writes) are no notes and are left out.
 */
export async function readNotes(root: string): Promise<Note[]> {
  const folder = join(root, NOTES_FOLDER);
  if (!existsSync(folder)) return [];
  const entries = await readdir(folder, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.')).map((entry) => entry.name);
  return Promise.all(
    names.map(async (name) => ({ name, text: (await readFile(join(folder, name), 'utf8')).replaceAll('\r\n', '\n') })),
  );
}

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
 * Sets `version` in package.json and every copy of it (`syncVersions`), writes the note files into CHANGELOG.md as the
 * version's dated section, at the top (`releaseSection`), and deletes them, and moves the README's pinned examples
 * onto it. Without note files the section is only its heading: the rehearsal rewrites a pull request that has none,
 * and `release.ts` refuses to release one.
 *
 * @param version `X.Y.Z`.
 * @param date The release's day, `YYYY-MM-DD`.
 * @throws When `version` is not X.Y.Z, a note file isn't one (`noteProblems`), package.json or a copy has nothing to
 *   replace, or CHANGELOG.md already has the version's section.
 */
export async function applyReleaseVersion(root: string, version: string, date = localDate()): Promise<void> {
  const parsed = parseVersion(version);
  if (parsed?.join('.') !== version) throw new Error(`"${version}" is not X.Y.Z`);
  const [major, minor] = parsed;
  const notes = await readNotes(root);
  const problems = notes.flatMap(noteProblems);
  if (problems.length) throw new Error(`${NOTES_FOLDER}/: ${problems.join('; ')}`);
  await editFile(root, 'package.json', (json) => json.replace(PACKAGE_VERSION, `"version": "${version}"`));
  await syncVersions(root);
  await editFile(root, 'CHANGELOG.md', (changelog) =>
    withSection(changelog, releaseSection(version, date, notes), version),
  );
  for (const note of notes) await rm(join(root, NOTES_FOLDER, note.name));
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
