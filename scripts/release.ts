#!/usr/bin/env node
/**
 * One-step release, run by the owner:
 *
 *   npm run release -- 0.4.0            set the version, build, run a sanity check and the smoke test, commit, tag
 *   npm run release -- 0.4.0 --push     ...and push (GitHub Actions then creates the GitHub Release and publishes
 *                                       to npm with provenance), wait for npm to have it, then lock the Astro starter
 *                                       on it and push that too
 *   npm run release -- 0.4.0 --starter  only lock the Astro starter on 0.4.0, which npm must have, and commit
 *                                       (with --push, push)
 *   node scripts/release.ts --rewrite-only 0.4.0 <folder>
 *                                       only write 0.4.0 into the tree at <folder> as a release does, for the
 *                                       `release-rehearsal` workflow
 *
 * The release doesn't run the whole gate: it needs HEAD's `ci` run on GitHub to have passed, and the release commit to
 * change only what the version rewrite changes. A test that fails only at a new version is caught before that, on the
 * pull request, by the rehearsal, which runs the gate at the next minor and patch versions.
 *
 * The starter's package.json and lockfile change together, by npm, and only to a version npm has: a release commit
 * leaves them on the previous release, so `npm ci` in the starter, and in every project `npm create astro` makes from
 * it, works at every commit. A release on an older minor line leaves main's starter alone.
 *
 * Needs a "## 0.4.0" or "## 0.4.0 (unreleased)" section in CHANGELOG.md first (the release notes come from it; the
 * heading is dated), a clean working tree, and HEAD at the branch the release goes on (a detached checkout works, so a
 * worktree can release). The version is set in package.json and written from there into every copy (`versions.ts`);
 * dist/ is rebuilt from it.
 *
 * A version on main's minor line or a newer one is released from main. An older minor line gets a maintenance release
 * from its branch `release/X.Y`, made once from that line's last tag (`git push origin vX.Y.Z:refs/heads/release/X.Y`);
 * the branch needs this script, `release-version.ts`, `.github/workflows/release.yml` and `ci.yml` from main first,
 * since a tag runs the workflow at its own commit and a push to the branch runs its own `ci.yml`. Deployed Worker copies install only a tag whose commit is on main, so the script also records the
 * maintenance commit in main's history, by a merge commit that keeps main's files as they are but for CHANGELOG.md,
 * which gets the release's section. The branch, main and the tag are pushed in one atomic push: all of them land, or
 * none does.
 */
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { compareVersions, parseVersion } from '../server/src/release-range.ts';
import { field } from '../server/src/shared/json.ts';
import { sectionOf, withSection } from './changelog.ts';
import { RELEASE_FILES, applyReleaseVersion, editFile } from './release-version.ts';
import { packageVersion } from './versions.ts';
import type { Version } from '../server/src/release-range.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = 'main';
const NPM_PACKAGE = '@occluze/tether';
const STARTER = 'examples/astro';
const STARTER_RANGE = /"@occluze\/tether": "[^"]*"/;
/** How long `--push` waits for the release workflow to publish to npm before leaving the starter to `--starter`. */
const NPM_PUBLISH_WAIT_MS = 20 * 60_000;
const NPM_POLL_MS = 30_000;

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

function checkClean(): void {
  if (output('git', ['status', '--porcelain'])) fail('working tree not clean: commit or stash first');
}

/**
 * Exits unless HEAD is exactly `branch` as fetched from GitHub. A release's commits go on top of what the branch is on
 * GitHub now, from any checkout (a worktree can't check out a branch another one holds).
 */
function checkHeadIs(branch: string): void {
  if (output('git', ['rev-parse', 'HEAD']) !== output('git', ['rev-parse', `origin/${branch}`])) {
    fail(`HEAD is not origin/${branch}: check it out (git switch --detach origin/${branch})`);
  }
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
  const runs: unknown = JSON.parse(listed);
  // gh lists the newest run first.
  const newest: unknown = Array.isArray(runs) ? runs[0] : undefined;
  if (newest === undefined) fail(`GitHub has no ci run for HEAD (${sha}): push it and wait for CI`);
  const url = String(field(newest, 'url'));
  if (field(newest, 'status') !== 'completed') fail(`CI is still running on HEAD (${sha}): wait for ${url}`);
  if (field(newest, 'conclusion') !== 'success') fail(`CI did not pass on HEAD (${sha}): ${url}`);
}

/**
 * Exits when the working tree changed anything but what the version rewrite changes: the files `applyReleaseVersion`
 * writes, the lockfile's copy of the version and the rebuilt dist/. CI passed on HEAD, so the release commit is that
 * tree with only the new version in it.
 */
function checkOnlyVersionChanged(): void {
  const allowed = new Set([...RELEASE_FILES, 'package-lock.json']);
  const changed = [
    ...output('git', ['diff', '--name-only', 'HEAD']).split('\n'),
    ...output('git', ['ls-files', '--others', '--exclude-standard']).split('\n'),
  ].filter((file) => file && !allowed.has(file) && !file.startsWith('dist/'));
  if (changed.length > 0) fail(`the release would change more than the version: ${changed.join(', ')}`);
}

/** Writes `version` into the tree at `root` as a release does: the files (`applyReleaseVersion`), then the lockfile. */
async function rewrite(root: string, version: string): Promise<void> {
  await applyReleaseVersion(root, version);
  run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--silent'], root);
}

/**
 * Exits when the version, the working tree, the branch or CHANGELOG.md isn't ready for `version`.
 *
 * @returns The branch the release goes on.
 */
async function checkReady(text: string): Promise<Line> {
  if (!text) fail('usage: npm run release -- X.Y.Z [--push]');
  const version = versionOrFail(text, 'the version');
  checkClean();
  run('git', ['fetch', '--quiet', 'origin', MAIN]);
  const mainPackage: unknown = JSON.parse(output('git', ['show', `origin/${MAIN}:package.json`]));
  const mainVersion = versionOrFail(String(field(mainPackage, 'version')), "main's version");
  const line = lineOf(version, mainVersion);
  const branch = branchOf(line);
  if (line.kind === 'maintenance') run('git', ['fetch', '--quiet', 'origin', branch]);
  checkHeadIs(branch);
  checkCiPassed(output('git', ['rev-parse', 'HEAD']));
  const current = versionOrFail(await packageVersion(ROOT), `${branch}'s version`);
  if (compareVersions(version, current) <= 0) fail(`${text} is not newer than ${current.join('.')}`);
  if (line.kind === 'maintenance' && (current[0] !== version[0] || current[1] !== version[1])) {
    fail(`${branch} is on ${current.join('.')}, not on the ${version[0]}.${version[1]} line`);
  }
  const changelog = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8');
  if (!new RegExp(`^## ${text.replace(/\./g, '\\.')}\\b`, 'm').test(changelog)) {
    fail(`add a "## ${text}" section to CHANGELOG.md first`);
  }
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
 * Exits when the working tree isn't clean, HEAD isn't origin/main, `text` isn't on main's minor line or npm doesn't
 * have it.
 */
async function lockStarter(text: string, push: boolean): Promise<void> {
  const [major, minor] = versionOrFail(text, 'the version');
  checkClean();
  run('git', ['fetch', '--quiet', 'origin', MAIN]);
  checkHeadIs(MAIN);
  const mainVersion = versionOrFail(await packageVersion(ROOT), "main's version");
  if (mainVersion[0] !== major || mainVersion[1] !== minor) {
    fail(`main is on ${mainVersion.join('.')}, so its starter stays on that minor version`);
  }
  if (!isOnNpm(text)) fail(`npm has no ${text} yet: run this again once the release workflow has published it`);
  const range = `^${String(major)}.${String(minor)}.0`;
  await editFile(
    ROOT,
    `${STARTER}/package.json`,
    (json) => json.replace(STARTER_RANGE, `"${NPM_PACKAGE}": "${range}"`),
    {
      optional: true,
    },
  );
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
    run('git', ['push', 'origin', `HEAD:${MAIN}`]);
    console.log(`Pushed the Astro starter on Tether ${text}.`);
  } else {
    console.log(`Committed the Astro starter on Tether ${text}. Push when ready: git push origin HEAD:${MAIN}`);
  }
}

async function release(version: string, push: boolean): Promise<void> {
  const line = await checkReady(version);
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
    fail(`the push was refused, so nothing was pushed (a branch moved?). To start over: ${retry}`);
  }
  console.log('Pushed. GitHub Actions creates the release and publishes to npm.');
  if (line.kind === 'maintenance') return;
  console.log(`Waiting for npm to have ${version}, to lock the Astro starter on it...`);
  if (await waitForNpm(version)) await lockStarter(version, true);
  else console.log(`npm doesn't have ${version} yet. ${lockLater}`);
}

const [version = '', folder] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const push = process.argv.includes('--push');
if (process.argv.includes('--rewrite-only')) {
  if (folder === undefined) fail('usage: node scripts/release.ts --rewrite-only X.Y.Z <folder>');
  await rewrite(resolve(folder), versionOrFail(version, 'the version').join('.'));
} else if (process.argv.includes('--starter')) await lockStarter(version, push);
else await release(version, push);
