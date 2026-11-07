// The package version has one source, the root package.json; the release script writes every copy from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_COPIES, packageVersion, syncVersions, versionMismatches } from '../scripts/versions.ts';
import { compareVersions, parseVersion } from '../server/src/release-range.ts';
import { asRecord, parseJson, recordAt, stringAt } from '../server/test/mocks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every copy of the version says what package.json says', async () => {
  assert.deepEqual(await versionMismatches(ROOT), []);
});

test('the release writes the package.json version into every copy', async () => {
  const copy = await mkdtemp(join(tmpdir(), 'tether-versions-'));
  for (const file of ['package.json', ...VERSION_COPIES.map((versionCopy) => versionCopy.file)]) {
    await cp(join(ROOT, file), join(copy, file), { recursive: true });
  }
  const pkg = asRecord(parseJson(await readFile(join(copy, 'package.json'), 'utf8')), 'package.json');
  await writeFile(join(copy, 'package.json'), JSON.stringify({ ...pkg, version: '9.8.7' }, null, 2));
  assert.equal((await versionMismatches(copy)).length, VERSION_COPIES.length);
  assert.equal(await syncVersions(copy), '9.8.7');
  assert.deepEqual(await versionMismatches(copy), []);
  assert.match(await readFile(join(copy, 'src/version.ts'), 'utf8'), /export const VERSION = '9\.8\.7';/);
});

test("the Astro starter's lockfile locks what its package.json asks for, so npm ci works in it", async () => {
  const starter = join(ROOT, 'examples/astro');
  const pkg = asRecord(parseJson(await readFile(join(starter, 'package.json'), 'utf8')), 'package.json');
  const lock = asRecord(parseJson(await readFile(join(starter, 'package-lock.json'), 'utf8')), 'package-lock.json');
  const packages = recordAt(lock, 'packages');
  assert.deepEqual(recordAt(packages, '')['dependencies'], pkg['dependencies']);

  const range = stringAt(recordAt(pkg, 'dependencies'), '@occluze/tether');
  const locked = stringAt(recordAt(packages, 'node_modules/@occluze/tether'), 'version');
  const lockedVersion = parseVersion(locked) ?? assert.fail(`the locked Tether ${locked} is not X.Y.Z`);
  const [major, minor] = lockedVersion;
  assert.equal(
    range,
    `^${String(major)}.${String(minor)}.0`,
    `the locked ${locked} is not the minor version asked for`,
  );
  // The starter moves onto a release only once npm has it, so it never locks one newer than this tree.
  const version = parseVersion(await packageVersion(ROOT)) ?? assert.fail('package.json has no X.Y.Z version');
  assert.ok(compareVersions(lockedVersion, version) <= 0, `the starter locks ${locked}, newer than this tree`);
});

test('the docs pin no release: the README, which the release rewrites, is the one place that names one', async () => {
  const docs = join(ROOT, 'docs');
  for (const file of await readdir(docs)) {
    const text = await readFile(join(docs, file), 'utf8');
    assert.doesNotMatch(text, /@v?\d+\.\d+\b/, `docs/${file} names a release in a URL; write @X.Y or @vX.Y.Z`);
  }
});
