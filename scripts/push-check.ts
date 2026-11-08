/**
 * Which check the pre-push hook runs (`pre-push.ts`), from the refs git hands the hook: the whole gate, or, for a push
 * that only adds commits that change only the Astro starter's package.json and lockfile, as `npm run release` makes
 * when it locks the starter on a new release, the test of the starter's range against its lockfile and Prettier on the
 * two files. The tree it pushes then differs from the one the remote has, which the gate last passed, in those two
 * files alone, and CI runs the whole gate on the push anyway.
 */
import { spawnSync } from 'node:child_process';

/** The files a starter-only push may change. */
export const STARTER_FILES: readonly string[] = ['examples/astro/package.json', 'examples/astro/package-lock.json'];

export type PushCheck = { kind: 'starter' } | { kind: 'gate'; reason: string };

/** What `pushCheck` asks git about a pushed ref's old tip `from` and new tip `to`; `null` when git can't tell. */
export interface History {
  /** Whether `from` is an ancestor of `to`: the push only adds commits, rewriting none. */
  isAncestor(from: string, to: string): boolean | null;
  /** The files whose content differs between the trees of `from` and `to`. */
  treeFiles(from: string, to: string): string[] | null;
  /** The files each commit in `from..to` changes, merges against each parent, listed together. */
  commitFiles(from: string, to: string): string[] | null;
}

/** The SHA git writes for a ref that doesn't exist: the remote's side of a new ref, or the local side of a deletion. */
const NO_COMMIT = /^0+$/;

/**
 * @param refs The hook's stdin: one `<local ref> <local sha> <remote ref> <remote sha>` line per pushed ref.
 * @returns The whole gate whenever git can't answer for one of the pushed refs (the remote's commit isn't in this
 *   clone).
 */
export function pushCheck(refs: string, history: History): PushCheck {
  const lines = refs
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { kind: 'gate', reason: 'git named no pushed refs' };
  for (const line of lines) {
    const [, localSha = '', remoteRef = '', remoteSha = ''] = line.split(' ');
    // A deletion pushes no commit.
    if (NO_COMMIT.test(localSha)) continue;
    if (remoteSha === '' || NO_COMMIT.test(remoteSha)) return { kind: 'gate', reason: `${remoteRef} is new` };
    const added = history.isAncestor(remoteSha, localSha);
    if (added === null) return { kind: 'gate', reason: `the history of ${remoteRef} can't be compared` };
    if (!added) return { kind: 'gate', reason: `the push rewrites the history of ${remoteRef}` };
    for (const [files, what] of [
      [history.treeFiles(remoteSha, localSha), 'the pushed tree'],
      [history.commitFiles(remoteSha, localSha), 'a pushed commit'],
    ] as const) {
      if (files === null) return { kind: 'gate', reason: `the files ${what} changes in ${remoteRef} can't be listed` };
      const other = files.find((file) => !STARTER_FILES.includes(file));
      if (other !== undefined) return { kind: 'gate', reason: `${what} changes ${other}` };
    }
  }
  return { kind: 'starter' };
}

/** The repository at `root`, as git answers for it. */
export function gitHistory(root: string): History {
  const git = (args: readonly string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const files = (args: readonly string[]) => {
    const result = git(args);
    return result.status === 0 ? result.stdout.split('\n').filter(Boolean) : null;
  };
  return {
    isAncestor(from, to) {
      const { status } = git(['merge-base', '--is-ancestor', from, to]);
      if (status === 0) return true;
      // 1 is git's "not an ancestor"; anything else, such as a commit this clone lacks, is no answer.
      return status === 1 ? false : null;
    },
    // Rename detection would list a renamed file by its new path alone, hiding the path it leaves.
    treeFiles: (from, to) => files(['diff', '--name-only', '--no-renames', from, to]),
    commitFiles: (from, to) => files(['log', '--format=', '--name-only', '--no-renames', '-m', `${from}..${to}`]),
  };
}
