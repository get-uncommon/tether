/**
 * The tree of the commit that records a maintenance release in main's history (`release.ts`): main's files, with the
 * release's CHANGELOG.md section added and the release's note files gone from main's .changes/ too, since a note
 * picked from main into the release branch would otherwise be released again by main's next release.
 */
import { NOTES_FOLDER, sectionOf, withSection } from './changelog.ts';

/** Runs git with `args`, and `input` on its stdin, and returns its output trimmed. */
export type Git = (args: string[], input?: string) => string;

/** One entry of `git ls-tree -z`: `<mode> <type> <object>\t<name>`. */
interface TreeEntry {
  /** Everything before the tab: mode, type and object. */
  object: string;
  name: string;
}

function treeEntries(git: Git, tree: string): TreeEntry[] {
  return git(['ls-tree', '-z', tree])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { object: line.slice(0, tab), name: line.slice(tab + 1) };
    });
}

function makeTree(git: Git, entries: TreeEntry[]): string {
  return git(['mktree', '-z'], entries.map((entry) => `${entry.object}\t${entry.name}\0`).join(''));
}

/**
 * @param main The commit the recording commit goes on: origin/main.
 * @param release The maintenance release commit, whose CHANGELOG.md has `version`'s section and which deleted the
 *   release's note files.
 * @returns The tree of `main` with `version`'s section added to its CHANGELOG.md, in version order, and without the
 *   note files `release` deleted; without .changes/ when that leaves it empty.
 * @throws When `release`'s CHANGELOG.md has no section for `version`.
 */
export function mainTreeWithRelease(git: Git, main: string, release: string, version: string): string {
  const section = sectionOf(git(['show', `${release}:CHANGELOG.md`]), version);
  if (section === null) throw new Error(`the release commit's CHANGELOG.md has no "## ${version}" section`);
  // `git` trims, and the file ends with a newline.
  const changelog = `${withSection(git(['show', `${main}:CHANGELOG.md`]), section, version)}\n`;
  const changelogBlob = git(['hash-object', '-w', '--stdin'], changelog);
  const released = new Set(
    git(['diff', '--name-only', '--no-renames', '--diff-filter=D', '-z', `${release}^`, release, '--', NOTES_FOLDER])
      .split('\0')
      .filter(Boolean),
  );
  // CHANGELOG.md is at the top level and note files are directly in NOTES_FOLDER, so only those two trees change.
  const entries = treeEntries(git, `${main}^{tree}`).flatMap((entry): TreeEntry[] => {
    if (entry.name === 'CHANGELOG.md') return [{ object: `100644 blob ${changelogBlob}`, name: entry.name }];
    if (entry.name !== NOTES_FOLDER) return [entry];
    const notes = treeEntries(git, `${main}:${NOTES_FOLDER}`).filter(
      (note) => !released.has(`${NOTES_FOLDER}/${note.name}`),
    );
    return notes.length ? [{ object: `040000 tree ${makeTree(git, notes)}`, name: entry.name }] : [];
  });
  return makeTree(git, entries);
}
