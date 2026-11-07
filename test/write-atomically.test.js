// scripts/write-atomically.ts, which writes the build's part and core files through a temporary file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TEMPORARY_SUFFIX, isBusyRename, writeAtomically } from '../scripts/write-atomically.ts';
import { tempFolder } from '../server/test/mocks.js';

/** @param {string} code */
const renameError = (code) => Object.assign(new Error(`${code}: rename`), { code });

test('a rename is retried only on Windows, where another handle on the file makes it fail for a while', () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    assert.equal(isBusyRename(renameError(code), 'win32'), true, `${code} on Windows`);
    // A read-only dist/ or file system: waiting wouldn't change it.
    for (const platform of /** @type {const} */ (['linux', 'darwin'])) {
      assert.equal(isBusyRename(renameError(code), platform), false, `${code} on ${platform}`);
    }
  }
  assert.equal(isBusyRename(renameError('ENOENT'), 'win32'), false);
  assert.equal(isBusyRename('EPERM', 'win32'), false);
});

test('a written file leaves no temporary file beside it, which the build counts as its own', async (t) => {
  const folder = await tempFolder(t, 'tether-write-');
  const file = join(folder, 'tether.search.min.js');
  await writeAtomically(file, 'first');
  await writeAtomically(file, 'second');
  assert.equal(await readFile(file, 'utf8'), 'second');
  assert.deepEqual(await readdir(folder), ['tether.search.min.js']);
  assert.match(`tether.search.min.js.tmp-${String(process.pid)}`, TEMPORARY_SUFFIX);
});

test("git ignores the temporary files an interrupted build leaves in dist/, so the release's clean check passes", () => {
  const root = join(import.meta.dirname, '..');
  /** @param {string} path @returns {boolean} */
  const ignored = (path) => {
    try {
      execFileSync('git', ['check-ignore', '--quiet', '--no-index', path], { cwd: root, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  // The build's folder check counts the same names as its own (`isBuildEntry` in scripts/build.ts).
  for (const file of ['tether.search.min.js', 'tether.min.js.map', 'tether.js']) {
    const temporary = `${file}.tmp-4242`;
    assert.match(temporary, TEMPORARY_SUFFIX);
    assert.equal(ignored(`dist/${temporary}`), true, temporary);
    assert.equal(ignored(`dist/${file}`), false, `${file} is committed`);
  }
});
