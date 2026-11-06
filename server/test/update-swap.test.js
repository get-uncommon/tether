// The updater's swap: a release replaces the copy's managed entries all at once, or not at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { install, RollbackError } from '../scripts/update-tether.ts';

/** The managed entries both folders hold, so a half-done swap shows as a mix of `old` and `new`. */
const ENTRIES = ['src/entry.js', 'bin/tether-sync.js', 'scripts/update-tether.mjs', 'package.json'];

/** @param {'old' | 'new'} content */
async function folderWith(content) {
  const folder = await mkdtemp(join(tmpdir(), `tether-swap-${content}-`));
  for (const entry of ENTRIES) {
    await mkdir(join(folder, entry, '..'), { recursive: true });
    await writeFile(join(folder, entry), content);
  }
  return folder;
}

/** @param {string} root */
async function contents(root) {
  return Promise.all(ENTRIES.map((entry) => readFile(join(root, entry), 'utf8')));
}

/** @param {string} root */
async function workFolders(root) {
  return (await readdir(root)).filter((name) => name.startsWith('.tether-update-'));
}

/**
 * A rename that throws on the call `failing` returns true for.
 *
 * @param {(from: string, call: number) => boolean} failing
 */
function renameFailing(failing) {
  let calls = 0;
  /** @type {(from: string, to: string) => Promise<void>} */
  return async (from, to) => {
    calls++;
    if (failing(from, calls)) throw new Error(`injected failure renaming ${from}`);
    await rename(from, to);
  };
}

test('swap: a release replaces every managed entry and leaves no work folder', async () => {
  const root = await folderWith('old');
  await install(await folderWith('new'), { root, rename });
  assert.deepEqual(await contents(root), ['new', 'new', 'new', 'new']);
  assert.deepEqual(await workFolders(root), []);
});

test('swap: a rename failing part-way puts every entry already swapped back, and the work folder goes', async () => {
  const root = await folderWith('old');
  // Calls 1 and 2 swap src; call 3 moves the copy's bin out, call 4 would move the release's bin in.
  const failOnFourth = renameFailing((_from, call) => call === 4);
  await assert.rejects(install(await folderWith('new'), { root, rename: failOnFourth }), /injected failure/);
  assert.deepEqual(await contents(root), ['old', 'old', 'old', 'old']);
  assert.deepEqual(await workFolders(root), []);
});

test("swap: when putting the copy back fails too, the error says so and the copy's own files are kept", async () => {
  const root = await folderWith('old');
  const previousFolder = `${sep}old${sep}`;
  let swapFailed = false;
  const failing = renameFailing((from, call) => {
    if (call === 4) swapFailed = true;
    return call === 4 || (swapFailed && from.includes(previousFolder));
  });
  const failure = await install(await folderWith('new'), { root, rename: failing }).then(
    () => assert.fail('the install succeeded'),
    /** @param {unknown} error */ (error) => error,
  );
  assert.ok(failure instanceof RollbackError);
  assert.match(failure.message, /the update failed \(injected failure.*\) and putting the copy back failed/);
  const [work, ...others] = await workFolders(root);
  assert.ok(work !== undefined && others.length === 0, 'one work folder is kept');
  assert.ok(failure.message.endsWith(`the copy's own files are in ${join(root, work, 'old')}`), failure.message);
  // The entry the put-back could not move is still in the kept folder, for a person to restore.
  assert.equal(await readFile(join(root, work, 'old', 'bin', 'tether-sync.js'), 'utf8'), 'old');
});

test('swap: a managed entry the release dropped is removed, and what belongs to the copy stays', async () => {
  const root = await folderWith('old');
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs', 'dropped.md'), 'old');
  await writeFile(join(root, 'notes.md'), 'the owner');
  await writeFile(join(root, 'tether-sync.config.js'), 'the mapping');
  await install(await folderWith('new'), { root, rename });
  assert.deepEqual(await contents(root), ['new', 'new', 'new', 'new']);
  assert.ok(!existsSync(join(root, 'docs')), 'docs/ is managed, and the release has none');
  assert.equal(await readFile(join(root, 'notes.md'), 'utf8'), 'the owner');
  assert.equal(await readFile(join(root, 'tether-sync.config.js'), 'utf8'), 'the mapping');
  assert.deepEqual(await workFolders(root), []);
});

test('swap: a failed swap puts back a managed entry the release dropped', async () => {
  const root = await folderWith('old');
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs', 'dropped.md'), 'old');
  // package.json is swapped after docs/, which the release doesn't have.
  const failOnPackage = renameFailing((from) => from.endsWith(`${sep}new${sep}package.json`));
  await assert.rejects(install(await folderWith('new'), { root, rename: failOnPackage }), /injected failure/);
  assert.deepEqual(await contents(root), ['old', 'old', 'old', 'old']);
  assert.equal(await readFile(join(root, 'docs', 'dropped.md'), 'utf8'), 'old');
});

test('swap: a release without the files every workflow runs is refused before the copy changes', async () => {
  const root = await folderWith('old');
  const release = await folderWith('new');
  await rm(join(release, 'scripts'), { recursive: true });
  await assert.rejects(install(release, { root, rename }), /the release has no scripts\/update-tether\.mjs/);
  assert.deepEqual(await contents(root), ['old', 'old', 'old', 'old']);
  assert.deepEqual(await workFolders(root), []);
});

test('swap: the work folder a failed rollback keeps is git-ignored, so the copy never commits it', async () => {
  const ignored = (await readFile(new URL('../.gitignore', import.meta.url), 'utf8')).split('\n');
  assert.ok(ignored.includes('.tether-update-*'));
});
