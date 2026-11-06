#!/usr/bin/env node
/**
 * One-step release, run by the owner:
 *
 *   npm run release -- 0.4.0            set the version, build, test, commit, tag
 *   npm run release -- 0.4.0 --push     ...and push (GitHub Actions then publishes to npm
 *                                       with provenance and creates the GitHub Release)
 *
 * Needs a "## 0.4.0" or "## 0.4.0 (unreleased)" section in CHANGELOG.md first (the release notes come from it; the
 * heading is dated), a clean working tree, and HEAD at origin/main (a detached checkout works, so a worktree can
 * release). The version is set in package.json and written from there into every copy (`versions.ts`); dist/ is
 * rebuilt from it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageVersion, syncVersions } from './versions.ts';

type Version = [major: number, minor: number, patch: number];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const PACKAGE_VERSION = /"version": "\d+\.\d+\.\d+"/;

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

/** @returns The command's output, trimmed. */
function output(command: string, args: string[]): string {
  return execFileSync(...spawnable(command, args), { cwd: ROOT, encoding: 'utf8', shell: needsShell(command) }).trim();
}

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

/** @param text `X.Y.Z` */
function parseVersion(text: string): Version {
  const [major = 0, minor = 0, patch = 0] = text.split('.').map(Number);
  return [major, minor, patch];
}

/** @returns True when `a` comes after `b`. */
function isNewer(a: Version, b: Version): boolean {
  const index = a.findIndex((part, position) => part !== b[position]);
  return index !== -1 && (a[index] ?? 0) > (b[index] ?? 0);
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

/** Exits when the version, the working tree, the branch or CHANGELOG.md isn't ready for `version`. */
async function checkReady(version: string): Promise<void> {
  if (!VERSION_PATTERN.test(version)) fail('usage: npm run release -- X.Y.Z [--push]');
  if (output('git', ['status', '--porcelain'])) fail('working tree not clean: commit or stash first');
  // The release commit goes on top of what main is on GitHub now, from any checkout (a worktree can't check out a
  // branch another one holds), so HEAD must be exactly origin/main.
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  if (output('git', ['rev-parse', 'HEAD']) !== output('git', ['rev-parse', 'origin/main'])) {
    fail('HEAD is not origin/main: check out origin/main (git switch --detach origin/main)');
  }
  const current = await packageVersion(ROOT);
  if (!isNewer(parseVersion(version), parseVersion(current))) fail(`${version} is not newer than ${current}`);
  const changelog = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8');
  if (!new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(changelog)) {
    fail(`add a "## ${version}" section to CHANGELOG.md first`);
  }
}

async function bump(version: string): Promise<void> {
  const [major, minor] = parseVersion(version);
  const packageJson = (text: string): string => text.replace(PACKAGE_VERSION, `"version": "${version}"`);
  await edit('package.json', packageJson);
  await syncVersions(ROOT);
  // The heading the notes were written under becomes the release's, dated in UTC.
  const date = new Date().toISOString().slice(0, 10);
  await edit('CHANGELOG.md', (text) => text.replace(`\n## ${version} (unreleased)\n`, `\n## ${version} (${date})\n`), {
    optional: true,
  });
  // Pinned examples in the README; ranges like @0.3 follow the minor version.
  await edit(
    'README.md',
    (text) =>
      text
        .replace(/@v\d+\.\d+\.\d+/g, `@v${version}`)
        .replace(/@\d+\.\d+\/dist/g, `@${major}.${minor}/dist`)
        .replace(/`@\d+\.\d+` gets every \d+\.\d+\.x fix/, `\`@${major}.${minor}\` gets every ${major}.${minor}.x fix`),
    { optional: true },
  );
}

const [version = ''] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const push = process.argv.includes('--push');

await checkReady(version);
await bump(version);
run('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund', '--silent']);
// npm and the Release ship the committed dist/, which carries the version: release.yml refuses a tag whose dist/
// differs from a fresh build.
run('npm', ['run', 'build']);
run('npm', ['test']);
run('npm', ['run', 'smoke']);
run('git', ['add', '-A']);
run('git', ['commit', '-q', '-m', `Tether ${version}`]);
run('git', ['tag', `v${version}`]);
console.log(`\nTagged v${version}.`);
if (push) {
  run('git', ['push', 'origin', 'HEAD:main']);
  run('git', ['push', 'origin', `v${version}`]);
  console.log('Pushed. GitHub Actions publishes to npm and creates the release.');
} else {
  console.log(`Push when ready: git push origin HEAD:main && git push origin v${version}`);
}
