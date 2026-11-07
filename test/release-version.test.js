// The release's version rewrite, which `npm run release` and the release-rehearsal workflow share: the version, and
// the note files in .changes/ written into CHANGELOG.md as the release's section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTES_FOLDER, releaseNotesProblems } from '../scripts/changelog.ts';
import {
  applyReleaseVersion,
  fileChanges,
  isReleaseCommitChange,
  localDate,
  readNotes,
} from '../scripts/release-version.ts';
import { VERSION_COPIES, versionMismatches } from '../scripts/versions.ts';
import { parseJson, stringAt, tempFolder } from '../server/test/mocks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = '# Changelog\n\n## 41.8.0 (2026-11-06)\n\n- Old.\n';
/** The next release's note files, by name. */
const NOTES = {
  'tooling.md': '- Repository: tooling.\n',
  'new.md': '- New.\n',
  'cart.md': '- Fix: the cart,\n  on two lines.\n',
};
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
  await mkdir(join(folder, NOTES_FOLDER));
  for (const [name, note] of Object.entries(NOTES)) await writeFile(join(folder, NOTES_FOLDER, name), note);
  return folder;
}

/**
 * @param {string} folder
 * @param {string} file
 */
const text = (folder, file) => readFile(join(folder, file), 'utf8');

test('a new minor version goes into package.json, every copy, the README pins and the CHANGELOG, from the notes', async (t) => {
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
    [
      '# Changelog',
      '',
      '## 41.9.0 (2026-12-01)',
      '',
      '- Fix: the cart,',
      '  on two lines.',
      '- New.',
      '- Repository: tooling.',
      '',
      '## 41.8.0 (2026-11-06)',
      '',
      '- Old.',
      '',
    ].join('\n'),
    'the notes are the dated section at the top',
  );
  assert.deepEqual(await readdir(join(folder, NOTES_FOLDER)), [], 'and their files are gone');
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
  assert.match(await text(folder, 'CHANGELOG.md'), /^# Changelog\n\n## 41\.8\.1 \(2026-12-01\)\n\n- Fix: the cart,$/m);
});

test('the rehearsal rewrites a tree without note files: the section is its heading alone', async (t) => {
  const folder = await scratchTree(t);
  for (const name of Object.keys(NOTES)) await rm(join(folder, NOTES_FOLDER, name));
  await applyReleaseVersion(folder, '41.9.0', '2026-12-01');
  assert.equal(
    await text(folder, 'CHANGELOG.md'),
    CHANGELOG.replace('\n\n## 41.8.0', '\n\n## 41.9.0 (2026-12-01)\n\n## 41.8.0'),
  );

  const bare = await scratchTree(t);
  await rm(join(bare, NOTES_FOLDER), { recursive: true });
  await applyReleaseVersion(bare, '41.9.0', '2026-12-01');
  assert.match(await text(bare, 'CHANGELOG.md'), /^## 41\.9\.0 \(2026-12-01\)$/m, 'nor a folder');
});

test('the release refuses to release without note files, or with a file that is no note', async (t) => {
  const folder = await scratchTree(t);
  assert.deepEqual(releaseNotesProblems(await readNotes(folder)), []);
  assert.deepEqual(releaseNotesProblems([]), [`no note files in ${NOTES_FOLDER}/: write one per change`]);

  await writeFile(join(folder, NOTES_FOLDER, 'heading.md'), '## Unreleased\n\n- Fix: one.\n');
  assert.deepEqual(releaseNotesProblems(await readNotes(folder)), [
    'heading.md: a note starts with a "- " bullet',
    'heading.md: a note has no heading; the release writes it',
  ]);
  const before = await text(folder, 'CHANGELOG.md');
  await assert.rejects(applyReleaseVersion(folder, '41.9.0', '2026-12-01'), /^Error: \.changes\/: heading\.md: /);
  assert.equal(await text(folder, 'CHANGELOG.md'), before, 'the rewrite refuses it too, before it changes anything');
  assert.equal(await text(folder, `${NOTES_FOLDER}/new.md`), NOTES['new.md']);
});

test('the rewrite reads only the note files, past the .DS_Store Finder writes and a folder, and leaves those', async (t) => {
  const folder = await scratchTree(t);
  await writeFile(join(folder, NOTES_FOLDER, '.DS_Store'), 'Bud1');
  await mkdir(join(folder, NOTES_FOLDER, 'drafts'));
  assert.deepEqual((await readNotes(folder)).map((note) => note.name).sort(), Object.keys(NOTES).sort());
  await applyReleaseVersion(folder, '41.9.0', '2026-12-01');
  assert.match(await text(folder, 'CHANGELOG.md'), /^## 41\.9\.0 \(2026-12-01\)\n\n- Fix: the cart,$/m);
  assert.deepEqual((await readdir(join(folder, NOTES_FOLDER))).sort(), ['.DS_Store', 'drafts']);
});

test('a note file with CRLF line ends, as core.autocrlf checks it out, is written with LF', async (t) => {
  const folder = await scratchTree(t);
  await writeFile(join(folder, NOTES_FOLDER, 'cart.md'), NOTES['cart.md'].replaceAll('\n', '\r\n'));
  await applyReleaseVersion(folder, '41.9.0', '2026-12-01');
  assert.match(await text(folder, 'CHANGELOG.md'), /^- Fix: the cart,\n {2}on two lines\.\n- New\.$/m);
});

test('the rewrite refuses a CHANGELOG that already has the version', async (t) => {
  const folder = await scratchTree(t);
  await assert.rejects(applyReleaseVersion(folder, '41.8.0', '2026-12-01'), /CHANGELOG\.md: nothing to change/);
});

test('a release commit may delete note files, and change only the release files besides', () => {
  const changes = fileChanges(
    'M\0package.json\0D\0.changes/café.md\0M\0dist/tether.min.js\0A\0.changes/new.md\0M\0src/cart.ts\0',
  );
  assert.deepEqual(
    changes.filter((change) => !isReleaseCommitChange(change.path, change.deleted)).map((change) => change.path),
    ['.changes/new.md', 'src/cart.ts'],
  );
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
