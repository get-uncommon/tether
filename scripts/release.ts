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
 * the branch needs this script, `release-starter.ts`, `release-version.ts`, `changelog.ts`, `github-runs.ts`,
 * `.github/workflows/release.yml`, `ci.yml` and `release-rehearsal.yml` from main first, since a tag runs the workflow
 * at its own commit and a push to the branch runs its own `ci.yml`. Deployed Worker copies install only a tag whose
 * commit is on main, so the script also records the maintenance commit in main's history, by a merge commit that keeps
 * main's files as they are but for CHANGELOG.md, which gets the release's section. The branch, main and the tag are
 * pushed in one atomic push: all of them land, or none does.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { compareVersions, parseVersion } from '../server/src/release-range.ts';
import { field } from '../server/src/shared/json.ts';
import { headingProblems, releaseNotesProblems, sectionOf, withSection } from './changelog.ts';
import { newestRun, rehearsalCommits, rehearsalPathspecs } from './github-runs.ts';
import { installMismatches } from './installed-packages.ts';
import { NPM_PACKAGE, StarterNotReady, lockStarterAfterRelease, withStarterRange } from './release-starter.ts';
import { applyReleaseVersion, editFile, fileChanges, isReleaseCommitChange, readNotes } from './release-version.ts';
import { packageVersion } from './versions.ts';
import type { Version } from '../server/src/release-range.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = 'main';
const STARTER = 'examples/astro';
/** How long `--push` waits for the release workflow to publish to npm before leaving the starter to `--starter`. */
const NPM_PUBLISH_WAIT_MS = 20 * 60_000;
const NPM_POLL_MS = 30_000;
/** How many of the packages node_modules has wrong the refusal names. */
const MISMATCHES_NAMED = 5;

/** The branch a release goes on, and whether it is main. */
type Line = { kind: 'main' } | { kind: 'maintenance'; branch: string };

function run(command: string, args: string[], cwd = ROOT): void {
  execFileSync(...spawnable(command, args), { cwd, stdio: 'inherit', shell: needsShell(command) });
}

/**
 * On Windows npm is `npm.cmd`, a batch file Node only starts through a shell. Its arguments here
 * are fixed words, so the shell has nothing to quote.
 */
function needsShell(command: string): boolean {
  return process.platform === 'win32' && command === 'npm';
}

function spawnable(command: string, args: string[]): [string, string[]] {
  return [needsShell(command) ? 'npm.cmd' : command, args];
}

/**
 * @param input Written to the command's stdin.
 * @returns The command's output, trimmed.
 */
function output(command: string, args: string[], input?: string): string {
  const options = { cwd: ROOT, encoding: 'utf8', shell: needsShell(command) } as const;
  return execFileSync(...spawnable(command, args), input === undefined ? options : { ...options, input }).trim();
}

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

/** @param text `X.Y.Z`, exactly as a tag names it. */
function versionOrFail(text: string, what: string): Version {
  const version = parseVersion(text);
  if (version?.join('.') !== text) fail(`${what} "${text}" is not X.Y.Z`);
  return version;
}

function branchOf(line: Line): string {
  return line.kind === 'main' ? MAIN : line.branch;
}

/**
 * Main for a version on main's minor line or newer, `release/X.Y` for an older line.
 *
 * @param mainVersion The version main is on.
 */
function lineOf(version: Version, mainVersion: Version): Line {
  const [major, minor] = version;
  if (compareVersions([major, minor, 0], [mainVersion[0], mainVersion[1], 0]) >= 0) return { kind: 'main' };
  return { kind: 'maintenance', branch: `release/${String(major)}.${String(minor)}` };
}

/**
 * Exits unless node_modules holds what package-lock.json locks: the release's commits run the pre-commit hook's
 * linters from it. It doesn't run `npm ci` itself, which would replace node_modules under this running script.
 */
async function checkInstalled(): Promise<void> {
  const hidden = join(ROOT, 'node_modules', '.package-lock.json');
  const installed: unknown = existsSync(hidden) ? JSON.parse(await readFile(hidden, 'utf8')) : null;
  const locked: unknown = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8'));
  const mismatches = installMismatches(locked, installed);
  if (mismatches.length === 0) return;
  const more = mismatches.length - MISMATCHES_NAMED;
  const named = mismatches.slice(0, MISMATCHES_NAMED).join(', ') + (more > 0 ? ` and ${String(more)} more` : '');
  fail(`node_modules doesn't match package-lock.json (${named}): run npm ci, then release again`);
}

function checkClean(): void {
  if (output('git', ['status', '--porcelain'])) fail('working tree not clean: commit or stash first');
}

/**
 * Exits unless HEAD is exactly `branch` as fetched from GitHub. A release's commits go on top of what the branch is on
 * GitHub now, from any checkout (a worktree can't check out a branch another one holds).
 */
function checkHeadIs(branch: string): void {
  if (!headIs(branch)) fail(notAtBranch(branch));
}

function headIs(branch: string): boolean {
  return output('git', ['rev-parse', 'HEAD']) === output('git', ['rev-parse', `origin/${branch}`]);
}

function isAncestorOfMain(commit: string): boolean {
  return spawnSync('git', ['merge-base', '--is-ancestor', commit, `origin/${MAIN}`], { cwd: ROOT }).status === 0;
}

function notAtBranch(branch: string): string {
  return `HEAD is not origin/${branch}: check it out (git switch --detach origin/${branch})`;
}

/**
 * Exits unless the newest run of the `ci` workflow for `sha` on GitHub passed. The release runs only a sanity check
 * itself: the whole gate ran in CI on this commit, and at the next versions in the `release-rehearsal` workflow on the
 * pull requests that led to it.
 */
function checkCiPassed(sha: string): void {
  let listed: string;
  try {
    listed = output('gh', ['run', 'list', '--workflow=ci.yml', `--commit=${sha}`, '--json=status,conclusion,url']);
  } catch {
    fail(`could not ask GitHub for the ci runs of ${sha} (is gh installed and logged in?)`);
  }
  const state = newestRun(listed);
  switch (state.kind) {
    case 'passed':
      return;
    case 'missing':
      return fail(`GitHub has no ci run for HEAD (${sha}): push it and wait for CI`);
    case 'running':
      return fail(`CI is still running on HEAD (${sha}): wait for ${state.url}`);
    case 'failed':
      return fail(`CI did not pass on HEAD (${sha}): ${state.url}`);
  }
}

/**
 * Exits unless the `release-rehearsal` workflow passed on the newest commit on `branch` that changes what it tests:
 * on that commit itself, or on the head of the pull request it was merged by. Every later commit leaves the tested
 * files as they are, so that run stands for HEAD. A commit pushed without a pull request has no rehearsal run; the
 * owner rehearses it by hand (`howToRehearse`) and passes `--rehearsed`.
 */
async function checkRehearsed(branch: string, version: string): Promise<void> {
  const workflow = await readFile(join(ROOT, '.github/workflows/release-rehearsal.yml'), 'utf8');
  const sha = output('git', [
    'log',
    '-1',
    '--first-parent',
    '--format=%H',
    'HEAD',
    '--',
    ...rehearsalPathspecs(workflow),
  ]);
  const states: string[] = [];
  try {
    const pulls = output('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/pulls`]);
    for (const commit of rehearsalCommits(sha, branch, pulls)) {
      const listed = output('gh', [
        'run',
        'list',
        '--workflow=release-rehearsal.yml',
        `--commit=${commit}`,
        '--json=status,conclusion,url',
      ]);
      const state = newestRun(listed);
      if (state.kind === 'passed') return;
      if (state.kind !== 'missing') states.push(`${state.kind}: ${state.url}`);
    }
  } catch {
    fail(`could not ask GitHub for the rehearsal runs of ${sha} (is gh installed and logged in?)`);
  }
  const found = states.length > 0 ? `its rehearsal ${states.join(', ')}` : 'it has no rehearsal run';
  fail(
    [
      `${sha}, the newest commit on ${branch} that changes what release-rehearsal tests, has not passed it (${found}).`,
      'Wait for a run that is going, or put the change through a pull request, which runs the rehearsal.',
      'Or rehearse it by hand and release with --rehearsed:',
      howToRehearse(version),
    ].join('\n'),
  );
}

/** The rehearsal workflow's steps, at the version being released, in a worktree next to this checkout. */
function howToRehearse(version: string): string {
  const folder = join(ROOT, '..', `tether-rehearsal-${version}`);
  return [
    `  git worktree add --detach "${folder}" HEAD`,
    `  node --experimental-strip-types scripts/release.ts --rewrite-only ${version} "${folder}"`,
    `  cd "${folder}" && npm ci && npm run check`,
    `  npm run release -- ${version} --rehearsed   (back in this checkout, once the check passed)`,
  ].join('\n');
}

/**
 * Exits when the working tree changed anything but what the version rewrite changes: the files `applyReleaseVersion`
 * writes, the lockfile's copy of the version, the rebuilt dist/ and the note files it deleted. CI passed on HEAD, so
 * the release commit is that tree with only the new version in it.
 */
function checkOnlyVersionChanged(): void {
  const untracked = output('git', ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const changed = [
    ...fileChanges(output('git', ['diff', '--name-status', '--no-renames', '-z', 'HEAD'])),
    ...untracked.map((path) => ({ path, deleted: false })),
  ]
    .filter((change) => !isReleaseCommitChange(change.path, change.deleted))
    .map((change) => change.path);
  if (changed.length > 0) fail(`the release would change more than the version: ${changed.join(', ')}`);
}

/** Writes `version` into the tree at `root` as a release does: the files (`applyReleaseVersion`), then the lockfile. */
async function rewrite(root: string, version: string): Promise<void> {
  await applyReleaseVersion(root, version);
  run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--silent'], root);
}

/**
 * Exits when the version, the working tree, the branch, CHANGELOG.md or the note files aren't ready for `version`.
 *
 * @returns The branch the release goes on.
 */
async function checkReady(text: string, rehearsed: boolean): Promise<Line> {
  if (!text) fail('usage: npm run release -- X.Y.Z [--push] [--rehearsed]');
  const version = versionOrFail(text, 'the version');
  await checkInstalled();
  checkClean();
  run('git', ['fetch', '--quiet', 'origin', MAIN]);
  const mainPackage: unknown = JSON.parse(output('git', ['show', `origin/${MAIN}:package.json`]));
  const mainVersion = versionOrFail(String(field(mainPackage, 'version')), "main's version");
  const line = lineOf(version, mainVersion);
  const branch = branchOf(line);
  if (line.kind === 'maintenance') run('git', ['fetch', '--quiet', 'origin', branch]);
  checkHeadIs(branch);
  checkCiPassed(output('git', ['rev-parse', 'HEAD']));
  if (!rehearsed) await checkRehearsed(branch, text);
  const current = versionOrFail(await packageVersion(ROOT), `${branch}'s version`);
  if (compareVersions(version, current) <= 0) fail(`${text} is not newer than ${current.join('.')}`);
  if (line.kind === 'maintenance' && (current[0] !== version[0] || current[1] !== version[1])) {
    fail(`${branch} is on ${current.join('.')}, not on the ${version[0]}.${version[1]} line`);
  }
  const changelog = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const problems = headingProblems(changelog);
  if (problems.length) fail(`CHANGELOG.md: ${problems.join('; ')}`);
  const noteProblems = releaseNotesProblems(await readNotes(ROOT));
  if (noteProblems.length) fail(`${text}'s notes: ${noteProblems.join('; ')}`);
  return line;
}

/**
 * @returns The tree of origin/main with the maintenance release's CHANGELOG.md section added to its CHANGELOG.md, in
 *   version order.
 */
function mainTreeWithSection(version: string): string {
  const mainTree = `origin/${MAIN}^{tree}`;
  const mainChangelog = output('git', ['show', `origin/${MAIN}:CHANGELOG.md`]);
  const section = sectionOf(output('git', ['show', 'HEAD:CHANGELOG.md']), version);
  if (section === null) fail(`the release commit's CHANGELOG.md has no "## ${version}" section`);
  // `output` trims, and the file ends with a newline.
  const changelog = `${withSection(mainChangelog, section, version)}\n`;
  const blob = output('git', ['hash-object', '-w', '--stdin'], changelog);
  // CHANGELOG.md is at the top level, so only main's top tree changes.
  const entries = output('git', ['ls-tree', mainTree])
    .split('\n')
    .map((entry) => (entry.endsWith('\tCHANGELOG.md') ? `100644 blob ${blob}\tCHANGELOG.md` : entry));
  return output('git', ['mktree'], `${entries.join('\n')}\n`);
}

/**
 * A merge commit on top of origin/main, fetched again first, with the maintenance release commit as second parent,
 * so the release's commit is in main's history and only main's CHANGELOG.md changes.
 *
 * @returns Its SHA.
 */
function mainHistoryCommit(version: string): string {
  run('git', ['fetch', '--quiet', 'origin', MAIN]);
  return output('git', [
    'commit-tree',
    mainTreeWithSection(version),
    '-p',
    `origin/${MAIN}`,
    '-p',
    'HEAD',
    '-m',
    `Record Tether ${version} in main's history`,
  ]);
}

/**
 * The push that publishes the release: the branch, main for a maintenance release, and the tag, which starts the
 * release workflow. `--atomic` makes GitHub take every ref or none, so the tag never lands without main, and a
 * branch that moved in the meantime leaves nothing half-pushed.
 */
function pushOf(line: Line, version: string): string[] {
  const tag = `refs/tags/v${version}`;
  if (line.kind === 'main') return ['push', '--atomic', 'origin', `HEAD:${MAIN}`, tag];
  return ['push', '--atomic', 'origin', `HEAD:${line.branch}`, `${mainHistoryCommit(version)}:${MAIN}`, tag];
}

function isOnNpm(version: string): boolean {
  // npm prints a package's only version as a string, and more than one as an array.
  const published: unknown = JSON.parse(output('npm', ['view', NPM_PACKAGE, 'versions', '--json']));
  return [published].flat().includes(version);
}

/** @returns Whether npm had `version` within `NPM_PUBLISH_WAIT_MS`. */
async function waitForNpm(version: string): Promise<boolean> {
  const deadline = Date.now() + NPM_PUBLISH_WAIT_MS;
  while (!isOnNpm(version)) {
    if (Date.now() > deadline) return false;
    await sleep(NPM_POLL_MS);
  }
  return true;
}

/**
 * Locks the Astro starter on `text`: its range becomes `^X.Y.0`, every patch of that minor version, and npm locks the
 * newest release in it, writing the lockfile's copy of the range too. Commits that on main, and pushes it with `push`.
 *
 * @throws {StarterNotReady} When the working tree isn't clean, HEAD isn't origin/main, `text` isn't on main's minor
 *   line, the starter's package.json has no Tether range to set (`withStarterRange`), npm doesn't have `text` or
 *   GitHub refuses the push.
 */
async function lockStarter(text: string, push: boolean): Promise<void> {
  const [major, minor] = versionOrFail(text, 'the version');
  if (output('git', ['status', '--porcelain']))
    throw new StarterNotReady('working tree not clean: commit or stash first');
  run('git', ['fetch', '--quiet', 'origin', MAIN]);
  if (!headIs(MAIN)) throw new StarterNotReady(notAtBranch(MAIN));
  const mainText = await packageVersion(ROOT);
  const mainVersion = parseVersion(mainText);
  if (mainVersion?.join('.') !== mainText) throw new StarterNotReady(`main's version "${mainText}" is not X.Y.Z`);
  if (mainVersion[0] !== major || mainVersion[1] !== minor) {
    throw new StarterNotReady(`main is on ${mainVersion.join('.')}, so its starter stays on that minor version`);
  }
  if (!isOnNpm(text)) {
    throw new StarterNotReady(`npm has no ${text} yet: run this again once the release workflow has published it`);
  }
  const range = `^${String(major)}.${String(minor)}.0`;
  // Optional: on a patch release the range is already `range`.
  await editFile(ROOT, `${STARTER}/package.json`, (json) => withStarterRange(json, range), { optional: true });
  run('npm', [
    'update',
    NPM_PACKAGE,
    '--prefix',
    STARTER,
    '--package-lock-only',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--silent',
  ]);
  if (!output('git', ['status', '--porcelain'])) {
    console.log(`The Astro starter already locks the newest Tether ${range}.`);
    return;
  }
  run('git', ['commit', '-q', '-a', '-m', `Lock Tether ${text} in the Astro starter`]);
  if (push) {
    try {
      run('git', ['push', 'origin', `HEAD:${MAIN}`]);
    } catch {
      throw new StarterNotReady(
        "the push of the starter's commit failed: either the pre-push hook failed, as its output above says, or " +
          'GitHub refused it because main moved',
      );
    }
    console.log(`Pushed the Astro starter on Tether ${text}.`);
  } else {
    console.log(`Committed the Astro starter on Tether ${text}. Push when ready: git push origin HEAD:${MAIN}`);
  }
}

async function release(version: string, push: boolean, rehearsed: boolean): Promise<void> {
  const line = await checkReady(version, rehearsed);
  await rewrite(ROOT, version);
  // npm and the Release ship the committed dist/, which carries the version: release.yml refuses a tag whose dist/
  // differs from a fresh build.
  run('npm', ['run', 'build']);
  checkOnlyVersionChanged();
  // Not the whole gate, which ran in CI on HEAD and at the next versions in the rehearsal: a check that every copy says
  // the new version, and the live smoke test, which release.yml runs on the tag too, so an API change found here
  // doesn't leave a tag without its Release.
  run(process.execPath, ['--experimental-strip-types', '--test', 'test/versions.test.js']);
  run('npm', ['run', 'smoke']);
  run('git', ['add', '-A']);
  run('git', ['commit', '-q', '-m', `Tether ${version}`]);
  run('git', ['tag', `v${version}`]);
  console.log(`\nTagged v${version} on ${branchOf(line)}.`);
  const retry = `git tag -d v${version} && git reset --hard origin/${branchOf(line)}, then run the release again`;
  const command = pushOf(line, version);
  const lockLater = `Once npm has ${version}: npm run release -- ${version} --starter --push`;
  if (!push) {
    console.log(`Push when ready: git ${command.join(' ')}`);
    console.log(`If GitHub refuses it, nothing was pushed. To start over: ${retry}`);
    if (line.kind === 'main') console.log(lockLater);
    return;
  }
  try {
    run('git', command);
  } catch {
    fail(
      `the push failed, so nothing was pushed: either the pre-push hook (npm run check and npm run lint:workflows) ` +
        `failed, as its output above says, or GitHub refused it because a branch moved. To start over: ${retry}`,
    );
  }
  console.log('Pushed. GitHub Actions creates the release and publishes to npm.');
  if (line.kind === 'maintenance') return;
  console.log(`Waiting for npm to have ${version}, to lock the Astro starter on it...`);
  await lockStarterAfterRelease(version, {
    waitForNpm: () => waitForNpm(version),
    lockStarter: async () => {
      // The starter's commit goes on main as GitHub has it now, which is past the release commit when someone pushed
      // to main during the wait. The checkout is clean, since the release commit holds every change. A main that no
      // longer holds the release commit was rewritten, which `lockStarter` refuses to build on.
      run('git', ['fetch', '--quiet', 'origin', MAIN]);
      if (!headIs(MAIN) && isAncestorOfMain('HEAD')) {
        console.log(`main moved during the wait: locking the starter on top of it, from a detached origin/${MAIN}.`);
        run('git', ['checkout', '--quiet', '--detach', `origin/${MAIN}`]);
      }
      await lockStarter(version, true);
    },
    log: (line) => {
      console.log(line);
    },
  });
}

const [version = '', folder] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const push = process.argv.includes('--push');
if (process.argv.includes('--rewrite-only')) {
  if (folder === undefined) fail('usage: node scripts/release.ts --rewrite-only X.Y.Z <folder>');
  await rewrite(resolve(folder), versionOrFail(version, 'the version').join('.'));
} else if (process.argv.includes('--starter')) {
  await checkInstalled();
  try {
    await lockStarter(version, push);
  } catch (error) {
    if (error instanceof StarterNotReady) fail(error.message);
    throw error;
  }
} else await release(version, push, process.argv.includes('--rehearsed'));
