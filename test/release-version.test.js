// The release's version rewrite, which `npm run release` and the release-rehearsal workflow share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyReleaseVersion, localDate } from '../scripts/release-version.ts';
import { VERSION_COPIES, versionMismatches } from '../scripts/versions.ts';
import { parseJson, stringAt, tempFolder } from '../server/test/mocks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = '# Changelog\n\n## Unreleased\n\n- New.\n\n## 41.8.0 (2026-11-06)\n\n- Old.\n';
const README = [
  '<script src="https://cdn.jsdelivr.net/gh/o/tether@41.8/dist/tether.min.js" defer></script>',
  '`@41.8` gets every 41.8.x fix automatically (recommended), `@v41.8.0` pins one release',
  '',
].join('\n');

/**
 * A folder with the files the rewrite changes, the version copies taken from this tree.
 *
 * @param {import('node:test').TestContext} t
 * @returns {Promise<string>}
 */
async function scratchTree(t) {
  const folder = await tempFolder(t, 'tether-release-version-');
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

test('a new minor version goes into package.json, every copy, the README pins and the CHANGELOG notes', async (t) => {
  const folder = await scratchTree(t);
  await applyReleaseVersion(folder, '41.9.0', '2026-12-01');
  assert.equal(stringAt(parseJson(await text(folder, 'package.json')), 'version'), '41.9.0');
  assert.deepEqual(await versionMismatches(folder), []);
  assert.equal((await text(folder, 'server/TETHER_VERSION')).trim(), '41.9');
  assert.equal(
    await text(folder, 'README.md'),
    [
      '<script src="https://cdn.jsdelivr.net/gh/o/tether@41.9/dist/tether.min.js" defer></script>',
      '`@41.9` gets every 41.9.x fix automatically (recommended), `@v41.9.0` pins one release',
      '',
    ].join('\n'),
  );
  assert.equal(
    await text(folder, 'CHANGELOG.md'),
    '# Changelog\n\n## Unreleased\n\n## 41.9.0 (2026-12-01)\n\n- New.\n\n## 41.8.0 (2026-11-06)\n\n- Old.\n',
    'the notes are dated under a new, empty "## Unreleased"',
  );
});

test("a patch version keeps the minor version's ranges", async (t) => {
  const folder = await scratchTree(t);
  await applyReleaseVersion(folder, '41.8.1', '2026-12-01');
  assert.deepEqual(await versionMismatches(folder), []);
  assert.equal((await text(folder, 'server/TETHER_VERSION')).trim(), '41.8');
  assert.match(
    await text(folder, 'README.md'),
    /tether@41\.8\/dist[^]*`@41\.8` gets every 41\.8\.x fix[^]*`@v41\.8\.1`/,
  );
  assert.match(await text(folder, 'CHANGELOG.md'), /^## Unreleased\n\n## 41\.8\.1 \(2026-12-01\)\n\n- New\.$/m);
});

test('the rewrite refuses a CHANGELOG without "## Unreleased"', async (t) => {
  const folder = await scratchTree(t);
  await writeFile(join(folder, 'CHANGELOG.md'), CHANGELOG.replace('## Unreleased', '## 41.9.0 (unreleased)'));
  await assert.rejects(applyReleaseVersion(folder, '41.9.0', '2026-12-01'), /CHANGELOG\.md: nothing to change/);
});

test('the rewrite refuses a version that is not X.Y.Z, before it changes anything', async (t) => {
  const folder = await scratchTree(t);
  const before = await text(folder, 'package.json');
  await assert.rejects(applyReleaseVersion(folder, '41.9'), /"41\.9" is not X\.Y\.Z/);
  assert.equal(await text(folder, 'package.json'), before);
});

test("the release is dated by the day in the release machine's time zone, not in UTC", async (t) => {
  const zone = process.env['TZ'];
  t.after(() => {
    if (zone === undefined) delete process.env['TZ'];
    else process.env['TZ'] = zone;
  });
  // 00:30 on 7 November in Amsterdam, 19:30 on 6 November in New York.
  const instant = new Date('2026-11-06T23:30:00Z');
  process.env['TZ'] = 'Europe/Amsterdam';
  assert.equal(localDate(instant), '2026-11-07');
  process.env['TZ'] = 'America/New_York';
  assert.equal(localDate(instant), '2026-11-06');

  process.env['TZ'] = 'Europe/Amsterdam';
  t.mock.timers.enable({ apis: ['Date'], now: instant });
  const folder = await scratchTree(t);
  await applyReleaseVersion(folder, '41.9.0');
  assert.match(await text(folder, 'CHANGELOG.md'), /^## 41\.9\.0 \(2026-11-07\)$/m, 'the default date');
});
