#!/usr/bin/env node
/**
 * One-step release, run by the owner:
 *
 *   npm run release -- 0.4.0            set the version, build, test, commit, tag
 *   npm run release -- 0.4.0 --push     ...and push (GitHub Actions then publishes to npm
 *                                       with provenance and creates the GitHub Release)
 *
 * Needs a "## 0.4.0" section in CHANGELOG.md first (the release notes come from it), a clean
 * working tree and the main branch. The version is set in package.json and written from there into every
 * copy (`versions.mjs`).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageVersion, syncVersions } from './versions.mjs';

/** @typedef {[major: number, minor: number, patch: number]} Version */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const PACKAGE_VERSION = /"version": "\d+\.\d+\.\d+"/;

/**
 * @param {string} command
 * @param {string[]} args
 */
function run(command, args) {
  execFileSync(...spawnable(command, args), { cwd: ROOT, stdio: 'inherit', shell: needsShell(command) });
}

/**
 * On Windows npm is `npm.cmd`, a batch file Node only starts through a shell. Its arguments here
 * are fixed words, so the shell has nothing to quote.
 *
 * @param {string} command
 * @returns {boolean}
 */
function needsShell(command) {
  return process.platform === 'win32' && command === 'npm';
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {[string, string[]]}
 */
function spawnable(command, args) {
  return [needsShell(command) ? 'npm.cmd' : command, args];
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string} The command's output, trimmed.
 */
function output(command, args) {
  return execFileSync(...spawnable(command, args), { cwd: ROOT, encoding: 'utf8', shell: needsShell(command) }).trim();
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

/**
 * @param {string} text `X.Y.Z`
 * @returns {Version}
 */
function parseVersion(text) {
  const [major = 0, minor = 0, patch = 0] = text.split('.').map(Number);
  return [major, minor, patch];
}

/**
 * @param {Version} a
 * @param {Version} b
 * @returns {boolean} True when `a` comes after `b`.
 */
function isNewer(a, b) {
  const index = a.findIndex((part, position) => part !== b[position]);
  return index !== -1 && (a[index] ?? 0) > (b[index] ?? 0);
}

/**
 * Rewrites `file` with `change`; fails when nothing changed, unless `optional`.
 *
 * @param {string} file
 * @param {(text: string) => string} change
 * @param {{ optional?: boolean }} [options]
 */
async function edit(file, change, { optional = false } = {}) {
  const path = join(ROOT, file);
  const before = await readFile(path, 'utf8');
  const after = change(before);
  if (after === before && !optional) fail(`${file}: nothing to change (pattern not found?)`);
  await writeFile(path, after);
}

/**
 * @param {string} version
 * @returns {Promise<void>}
 * @throws Exits when the version, the working tree, the branch or CHANGELOG.md isn't ready for it.
 */
async function checkReady(version) {
  if (!VERSION_PATTERN.test(version)) fail('usage: npm run release -- X.Y.Z [--push]');
  if (output('git', ['status', '--porcelain'])) fail('working tree not clean: commit or stash first');
  if (output('git', ['branch', '--show-current']) !== 'main') fail('not on main');
  const current = await packageVersion(ROOT);
  if (!isNewer(parseVersion(version), parseVersion(current))) fail(`${version} is not newer than ${current}`);
  const changelog = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8');
  if (!new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(changelog)) {
    fail(`add a "## ${version}" section to CHANGELOG.md first`);
  }
}

/** @param {string} version */
async function bump(version) {
  const [major, minor] = parseVersion(version);
  /** @param {string} text */
  const packageJson = (text) => text.replace(PACKAGE_VERSION, `"version": "${version}"`);
  await edit('package.json', packageJson);
  await syncVersions(ROOT);
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
run('npm', ['test']);
run('npm', ['run', 'smoke']);
run('git', ['add', '-A']);
run('git', ['commit', '-q', '-m', `Tether ${version}`]);
run('git', ['tag', `v${version}`]);
console.log(`\nTagged v${version}.`);
if (push) {
  run('git', ['push', 'origin', 'main']);
  run('git', ['push', 'origin', `v${version}`]);
  console.log('Pushed. GitHub Actions publishes to npm and creates the release.');
} else {
  console.log(`Push when ready: git push origin main && git push origin v${version}`);
}
