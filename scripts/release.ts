#!/usr/bin/env node
/**
 * One-step release, run by the owner:
 *
 *   npm run release -- 0.4.0            set the version, build, run the gate, commit, tag
 *   npm run release -- 0.4.0 --push     ...and push (GitHub Actions then creates the GitHub Release and publishes
 *                                       to npm with provenance)
 *
 * Needs a "## 0.4.0" or "## 0.4.0 (unreleased)" section in CHANGELOG.md first (the release notes come from it; the
 * heading is dated), a clean working tree, and HEAD at the branch the release goes on (a detached checkout works, so a
 * worktree can release). The version is set in package.json and written from there into every copy (`versions.ts`);
 * dist/ is rebuilt from it.
 *
 * A version on main's minor line or a newer one is released from main. An older minor line gets a maintenance release
 * from its branch `release/X.Y`, made once from that line's last tag (`git push origin vX.Y.Z:refs/heads/release/X.Y`);
 * the branch needs this script and `.github/workflows/release.yml` from main first, since a tag runs the workflow at
 * its own commit. Deployed Worker copies install only a tag whose commit is on main, so the script also records the
 * maintenance commit in main's history, by a merge commit that keeps main's files as they are but for CHANGELOG.md,
 * which gets the release's section. The branch, main and the tag are pushed in one atomic push: all of them land, or
 * none does.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, parseVersion } from '../server/src/release-range.ts';
import { field } from '../server/src/shared/json.ts';
import { sectionOf, withSection } from './changelog.ts';
import { packageVersion, syncVersions } from './versions.ts';
import type { Version } from '../server/src/release-range.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_VERSION = /"version": "\d+\.\d+\.\d+"/;
const MAIN = 'main';

/** The branch a release goes on, and whether it is main. */
type Line = { kind: 'main' } | { kind: 'maintenance'; branch: string };

function run(command: string, args: string[]): void {
  execFileSync(...spawnable(command, args), { cwd: ROOT, stdio: 'inherit', shell: needsShell(command) });
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
 * Rewrites `file` with `change`; fails when nothing changed, unless `optional`.
 */
async function edit(file: string, change: (text: string) => string, { optional = false } = {}): Promise<void> {
  const path = join(ROOT, file);
  const before = await readFile(path, 'utf8');
  const after = change(before);
  if (after === before && !optional) fail(`${file}: nothing to change (pattern not found?)`);
  await writeFile(path, after);
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
 * Exits when the version, the working tree, the branch or CHANGELOG.md isn't ready for `version`.
 *
 * @returns The branch the release goes on.
 */
async function checkReady(text: string): Promise<Line> {
  if (!text) fail('usage: npm run release -- X.Y.Z [--push]');
  const version = versionOrFail(text, 'the version');
  if (output('git', ['status', '--porcelain'])) fail('working tree not clean: commit or stash first');
  run('git', ['fetch', '--quiet', 'origin', MAIN]);
  const mainPackage: unknown = JSON.parse(output('git', ['show', `origin/${MAIN}:package.json`]));
  const mainVersion = versionOrFail(String(field(mainPackage, 'version')), "main's version");
  const line = lineOf(version, mainVersion);
  const branch = branchOf(line);
  if (line.kind === 'maintenance') run('git', ['fetch', '--quiet', 'origin', branch]);
  // The release commit goes on top of what the branch is on GitHub now, from any checkout (a worktree can't check out
  // a branch another one holds), so HEAD must be exactly that branch.
  if (output('git', ['rev-parse', 'HEAD']) !== output('git', ['rev-parse', `origin/${branch}`])) {
    fail(`HEAD is not origin/${branch}: check it out (git switch --detach origin/${branch})`);
  }
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

async function bump(text: string): Promise<void> {
  const [major, minor] = versionOrFail(text, 'the version');
  const packageJson = (json: string): string => json.replace(PACKAGE_VERSION, `"version": "${text}"`);
  await edit('package.json', packageJson);
  await syncVersions(ROOT);
  // The heading the notes were written under becomes the release's, dated in UTC.
  const date = new Date().toISOString().slice(0, 10);
  await edit(
    'CHANGELOG.md',
    (changelog) => changelog.replace(`\n## ${text} (unreleased)\n`, `\n## ${text} (${date})\n`),
    {
      optional: true,
    },
  );
  // Pinned examples in the README; ranges like @0.3 follow the minor version.
  await edit(
    'README.md',
    (readme) =>
      readme
        .replace(/@v\d+\.\d+\.\d+/g, `@v${text}`)
        .replace(/@\d+\.\d+\/dist/g, `@${major}.${minor}/dist`)
        .replace(/`@\d+\.\d+` gets every \d+\.\d+\.x fix/, `\`@${major}.${minor}\` gets every ${major}.${minor}.x fix`),
    { optional: true },
  );
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

const [version = ''] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const push = process.argv.includes('--push');

const line = await checkReady(version);
await bump(version);
run('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund', '--silent']);
// npm and the Release ship the committed dist/, which carries the version: release.yml refuses a tag whose dist/
// differs from a fresh build.
run('npm', ['run', 'build']);
// The whole gate, as release.yml runs it on the tag: a tag the workflow refuses would stay without its Release.
run('npm', ['run', 'check']);
run('npm', ['run', 'smoke']);
run('git', ['add', '-A']);
run('git', ['commit', '-q', '-m', `Tether ${version}`]);
run('git', ['tag', `v${version}`]);
console.log(`\nTagged v${version} on ${branchOf(line)}.`);
const retry = `git tag -d v${version} && git reset --hard origin/${branchOf(line)}, then run the release again`;
const command = pushOf(line, version);
if (push) {
  try {
    run('git', command);
  } catch {
    fail(`the push was refused, so nothing was pushed (a branch moved?). To start over: ${retry}`);
  }
  console.log('Pushed. GitHub Actions creates the release and publishes to npm.');
} else {
  console.log(`Push when ready: git ${command.join(' ')}`);
  console.log(`If GitHub refuses it, nothing was pushed. To start over: ${retry}`);
}
