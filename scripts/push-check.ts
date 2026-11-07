/**
 * Which check the pre-push hook runs (`pre-push.ts`), from the refs git hands the hook: the whole gate, or for a push
 * whose every commit changes only the Astro starter's package.json and lockfile, as `npm run release` makes when it
 * locks the starter on a new release, the test of the starter's range against its lockfile and Prettier on the two
 * files. Nothing else in the tree changed, so the gate the rest of it last passed still holds, and CI runs the whole
 * gate on the push anyway.
 */

/** The files a starter-only push may change. */
export const STARTER_FILES: readonly string[] = ['examples/astro/package.json', 'examples/astro/package-lock.json'];

export type PushCheck = { kind: 'starter' } | { kind: 'gate'; reason: string };

/** The SHA git writes for a ref that doesn't exist: the remote's side of a new ref, or the local side of a deletion. */
const NO_COMMIT = /^0+$/;

/**
 * @param refs The hook's stdin: one `<local ref> <local sha> <remote ref> <remote sha>` line per pushed ref.
 * @param filesOf The files each commit in a `<remote sha>..<local sha>` range changes, listed together, or `null` when
 *   git can't list them (the remote's commit isn't in this clone).
 * @returns The whole gate whenever the pushed commits can't all be listed.
 */
export function pushCheck(refs: string, filesOf: (range: string) => string[] | null): PushCheck {
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
    const files = filesOf(`${remoteSha}..${localSha}`);
    if (files === null) return { kind: 'gate', reason: `the commits pushed to ${remoteRef} can't be listed` };
    const other = files.find((file) => !STARTER_FILES.includes(file));
    if (other !== undefined) return { kind: 'gate', reason: `a pushed commit changes ${other}` };
  }
  return { kind: 'starter' };
}
