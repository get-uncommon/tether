#!/usr/bin/env node
/**
 * One-step release, run by the owner:
 *
 *   npm run release -- 0.4.0            set the version, build, run a sanity check and the smoke test, commit, tag
 *   npm run release -- 0.4.0 --push     ...and push (GitHub Actions then creates the GitHub Release and publishes
 *                                       to npm with provenance), wait for npm to have it, then lock the Astro starter
 *                                       on it and push that too, on top of main as it is by then
 *   npm run release -- 0.4.0 --rehearsed
 *                                       ...for a HEAD whose change has no passed rehearsal run, after rehearsing it
 *                                       by hand (`howToRehearse`)
 *   npm run release -- 0.4.0 --starter  only lock the Astro starter on 0.4.0, which npm must have, and commit
 *                                       (with --push, push)
 *   node scripts/release.ts --rewrite-only 0.4.0 <folder>
 *                                       only write 0.4.0 into the tree at <folder> as a release does, for the
 *                                       `release-rehearsal` workflow
 *
 * The release doesn't run the whole gate itself: it needs HEAD's `ci` run on GitHub to have passed, and the release
 * commit to change only what the version rewrite changes. A test that fails only at a new version is caught before
 * that, on the pull request, by the rehearsal, which runs the gate at the next minor and patch versions; the release
 * needs it to have passed on the newest change it tested (`checkRehearsed`). With `--push`, the release's own push
 * goes through the pre-push hook, which runs `npm run check` and `npm run lint:workflows` for a push with a new tag, so
 * the whole gate does run there, and a hook that fails stops the push.
 *
 * The starter's package.json and lockfile change together, by npm, and only to a version npm has: a release commit
 * leaves them on the previous release, so `npm ci` in the starter, and in every project `npm create astro` makes from
 * it, works at every commit. A release on an older minor line leaves main's starter alone.
 *
 * Needs the release's note files in .changes/ first (they become its dated section in CHANGELOG.md, which the
 * GitHub Release's notes come from, and the release commit deletes them), a clean working tree, and HEAD at the
 * branch the release goes on (a detached checkout works, so a worktree can release). The version is set in
 * package.json and written from there into every copy (`versions.ts`); dist/ is rebuilt from it.
 *
 * A version on main's minor line or a newer one is released from main. An older minor line gets a maintenance release
 * from its branch `release/X.Y`, made once from that line's last tag (`git push origin vX.Y.Z:refs/heads/release/X.Y`);
 * the branch needs the release's scripts and workflows from main first (`releaseTooling`), since a tag runs the
 * workflow at its own commit and a push to the branch runs its own `ci.yml`. Deployed Worker copies install only a tag
 * whose commit is on main, so the script also records the maintenance commit in main's history, by a merge commit that
 * keeps main's files as they are but for CHANGELOG.md, which gets the release's section, and .changes/, which loses
 * the release's note files (`mainTreeWithRelease`). The branch, main and the tag are pushed in one atomic push: all of
 * them land, or none does.
 *
 * The steps are in `release-steps.ts`, imported only once the tree has every file, package and npm script the release
 * needs (`releaseToolingProblems`), so a maintenance branch that lacks some of them hears which, all at once, where
 * Node would name only the first import it can't find.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseToolingProblems } from './release-tooling.ts';

const problems = await releaseToolingProblems(join(dirname(fileURLToPath(import.meta.url)), '..'));
if (problems.length) {
  console.error(`release: this tree lacks what the release needs:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
await import('./release-steps.ts');
