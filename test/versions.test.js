// The package version has one source, the root package.json; the release script writes every copy from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_COPIES, syncVersions, versionMismatches } from '../scripts/versions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every copy of the version says what package.json says', async () => {
  assert.deepEqual(await versionMismatches(ROOT), []);
});

test('the release writes the package.json version into every copy', async () => {
  const copy = await mkdtemp(join(tmpdir(), 'tether-versions-'));
  for (const file of ['package.json', ...VERSION_COPIES.map((versionCopy) => versionCopy.file)]) {
    await cp(join(ROOT, file), join(copy, file), { recursive: true });
  }
  const pkg = JSON.parse(await readFile(join(copy, 'package.json'), 'utf8'));
  await writeFile(join(copy, 'package.json'), JSON.stringify({ ...pkg, version: '9.8.7' }, null, 2));
  assert.equal((await versionMismatches(copy)).length, VERSION_COPIES.length);
  assert.equal(await syncVersions(copy), '9.8.7');
  assert.deepEqual(await versionMismatches(copy), []);
  assert.match(await readFile(join(copy, 'src/index.js'), 'utf8'), /export const VERSION = '9\.8\.7';/);
});
