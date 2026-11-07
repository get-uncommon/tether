// The release's version rewrite, which `npm run release` and the release-rehearsal workflow share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyReleaseVersion } from '../scripts/release-version.ts';
import { VERSION_COPIES, versionMismatches } from '../scripts/versions.ts';
import { parseJson, stringAt } from '../server/test/mocks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = '# Changelog\n\n## 0.9.0 (unreleased)\n\n- New.\n\n## 0.8.0 (2026-11-06)\n\n- Old.\n';
const README = [
  '<script src="https://cdn.jsdelivr.net/gh/o/tether@0.8/dist/tether.min.js" defer></script>',
  '`@0.8` gets every 0.8.x fix automatically (recommended), `@v0.8.0` pins one release',
  '',
].join('\n');

/**
 * A folder with the files the rewrite changes, the version copies taken from this tree.
 *
 * @returns {Promise<string>}
 */
async function scratchTree() {
  const folder = await mkdtemp(join(tmpdir(), 'tether-release-version-'));
  for (const file of ['package.json', ...VERSION_COPIES.map((copy) => copy.file)]) {
    await cp(join(ROOT, file), join(folder, file), { recursive: true });
  }
  await writeFile(join(folder, 'CHANGELOG.md'), CHANGELOG);
  await writeFile(join(folder, 'README.md'), README);
  return folder;
}

/**
 * @param {string} folder
 * @param {string} file
 */
const text = (folder, file) => readFile(join(folder, file), 'utf8');

test('a new minor version goes into package.json, every copy, the README pins and its CHANGELOG heading', async () => {
  const folder = await scratchTree();
  await applyReleaseVersion(folder, '0.9.0', '2026-12-01');
  assert.equal(stringAt(parseJson(await text(folder, 'package.json')), 'version'), '0.9.0');
  assert.deepEqual(await versionMismatches(folder), []);
  assert.equal((await text(folder, 'server/TETHER_VERSION')).trim(), '0.9');
  assert.equal(
    await text(folder, 'README.md'),
    [
      '<script src="https://cdn.jsdelivr.net/gh/o/tether@0.9/dist/tether.min.js" defer></script>',
      '`@0.9` gets every 0.9.x fix automatically (recommended), `@v0.9.0` pins one release',
      '',
    ].join('\n'),
  );
  assert.equal(await text(folder, 'CHANGELOG.md'), CHANGELOG.replace('0.9.0 (unreleased)', '0.9.0 (2026-12-01)'));
});

test("a patch version keeps the minor version's ranges, and a CHANGELOG without its heading as it is", async () => {
  const folder = await scratchTree();
  await applyReleaseVersion(folder, '0.8.1');
  assert.deepEqual(await versionMismatches(folder), []);
  assert.equal((await text(folder, 'server/TETHER_VERSION')).trim(), '0.8');
  assert.match(await text(folder, 'README.md'), /tether@0\.8\/dist[^]*`@0\.8` gets every 0\.8\.x fix[^]*`@v0\.8\.1`/);
  assert.equal(await text(folder, 'CHANGELOG.md'), CHANGELOG);
});

test('the rewrite refuses a version that is not X.Y.Z, before it changes anything', async () => {
  const folder = await scratchTree();
  const before = await text(folder, 'package.json');
  await assert.rejects(applyReleaseVersion(folder, '0.9'), /"0\.9" is not X\.Y\.Z/);
  assert.equal(await text(folder, 'package.json'), before);
});
