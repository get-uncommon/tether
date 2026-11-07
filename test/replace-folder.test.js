// The build's swap of its output folder: a new folder replaces the old one whole, or the old one stays as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { replaceFolder } from '../scripts/replace-folder.ts';
import { tempFolder } from '../server/test/mocks.js';

/**
 * @param {string} folder
 * @returns {Promise<Record<string, string>>} Each file under `folder`, by its path relative to it, to its content.
 */
async function contents(folder) {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  /** @type {Record<string, string>} */
  const files = {};
  for (const entry of entries.filter((found) => found.isFile())) {
    const file = join(entry.parentPath, entry.name);
    files[file.slice(folder.length + 1)] = await readFile(file, 'utf8');
  }
  return files;
}

/** @param {import('node:test').TestContext} t */
async function oldOutput(t) {
  const parent = await tempFolder(t, 'tether-replace-folder-');
  const out = join(parent, 'dist');
  await mkdir(join(out, 'esm'), { recursive: true });
  await writeFile(join(out, 'tether.min.js'), 'old core');
  await writeFile(join(out, 'esm', 'index.js'), 'old module');
  return { parent, out, before: await contents(out) };
}

/** @param {string} folder Writes a new build's files into it. */
async function writeNew(folder) {
  await writeFile(join(folder, 'tether.min.js'), 'new core');
}

test('the new folder replaces the old one whole, and nothing is left beside it', async (t) => {
  const { parent, out } = await oldOutput(t);
  await replaceFolder(out, writeNew);
  assert.deepEqual(await contents(out), { 'tether.min.js': 'new core' });
  assert.deepEqual(await readdir(parent), ['dist']);
});

test('a step that fails leaves the old folder as it was, and nothing beside it', async (t) => {
  const { parent, out, before } = await oldOutput(t);
  await assert.rejects(
    replaceFolder(out, async (folder) => {
      await writeNew(folder);
      throw new Error('the declaration build failed');
    }),
    /the declaration build failed/,
  );
  assert.deepEqual(await contents(out), before);
  assert.deepEqual(await readdir(parent), ['dist']);
});

test('a rename of the new folder into place that fails puts the old folder back as it was', async (t) => {
  const { parent, out, before } = await oldOutput(t);
  let moves = 0;
  /** @type {(from: string, to: string) => Promise<void>} */
  const move = async (from, to) => {
    moves += 1;
    if (to === out && !from.endsWith('-previous')) throw new Error('EBUSY: resource busy or locked');
    await rename(from, to);
  };
  await assert.rejects(replaceFolder(out, writeNew, move), /EBUSY/);
  assert.deepEqual(await contents(out), before);
  assert.deepEqual(await readdir(parent), ['dist']);
  assert.equal(moves, 3, 'aside, in (refused), back');
});

test('a rename of the old folder aside that fails leaves it as it was', async (t) => {
  const { parent, out, before } = await oldOutput(t);
  /** @type {(from: string, to: string) => Promise<void>} */
  const move = async (from, to) => {
    if (from === out) throw new Error('EPERM: operation not permitted');
    await rename(from, to);
  };
  await assert.rejects(replaceFolder(out, writeNew, move), /EPERM/);
  assert.deepEqual(await contents(out), before);
  assert.deepEqual(await readdir(parent), ['dist']);
});

test('a first build makes the folder, and its parent', async (t) => {
  const parent = await tempFolder(t, 'tether-replace-folder-');
  const out = join(parent, 'site', 'dist');
  await replaceFolder(out, writeNew);
  assert.deepEqual(await contents(out), { 'tether.min.js': 'new core' });
  assert.deepEqual(await readdir(join(parent, 'site')), ['dist']);
});
