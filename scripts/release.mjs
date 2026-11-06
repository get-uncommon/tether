#!/usr/bin/env node
// @ts-nocheck
/**
 * One-step release:
 *
 *   npm run release -- 0.4.0            bump everywhere, build, test, commit, tag
 *   npm run release -- 0.4.0 --push     ...and push (GitHub Actions then publishes to npm
 *                                       with provenance and creates the GitHub Release)
 *
 * Needs a "## 0.4.0" section in CHANGELOG.md first (the release notes come from it), a clean
 * working tree and the main branch.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [version] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const push = process.argv.includes('--push');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
const out = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

if (!/^\d+\.\d+\.\d+$/.test(version || '')) fail('usage: npm run release -- X.Y.Z [--push]');
if (out('git', ['status', '--porcelain'])) fail('working tree not clean: commit or stash first');
if (out('git', ['branch', '--show-current']) !== 'main') fail('not on main');
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const [a, b, c] = pkg.version.split('.').map(Number);
const [x, y, z] = version.split('.').map(Number);
if (x * 1e6 + y * 1e3 + z <= a * 1e6 + b * 1e3 + c) fail(`${version} is not newer than ${pkg.version}`);
const changelog = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8');
if (!new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(changelog))
  fail(`add a "## ${version}" section to CHANGELOG.md first`);

async function edit(file, fn, { optional = false } = {}) {
  const p = join(ROOT, file);
  const before = await readFile(p, 'utf8');
  const after = fn(before);
  if (after === before && !optional) fail(`${file}: nothing to change (pattern not found?)`);
  await writeFile(p, after);
}
const json = (s) => s.replace(/"version": "\d+\.\d+\.\d+"/, `"version": "${version}"`);

await edit('package.json', json);
await edit('server/package.json', json);
await edit('src/index.js', (s) => s.replace(/export const VERSION = '[^']+';/, `export const VERSION = '${version}';`));
await edit('server/src/version.js', (s) =>
  s.replace(/export const VERSION = '[^']+';/, `export const VERSION = '${version}';`),
);
// Pinned examples in the README (ranges like @0.3 follow the minor version).
await edit(
  'README.md',
  (s) =>
    s
      .replace(/@v\d+\.\d+\.\d+/g, `@v${version}`)
      .replace(/@\d+\.\d+\/dist/g, `@${x}.${y}/dist`)
      .replace(/`@\d+\.\d+` gets every \d+\.\d+\.x fix/, `\`@${x}.${y}\` gets every ${x}.${y}.x fix`),
  { optional: true },
);
// server/TETHER_VERSION stays 'latest': deployed sync copies follow every release (weekly updater).

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
