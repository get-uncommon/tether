// CHANGELOG.md's sections: each release's section as its tag has it, the section a release writes from the note files
// in .changes/, and a maintenance release's section, which the release script adds to main's CHANGELOG.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headingProblems, noteProblems, releaseSection, sectionOf, withSection } from '../scripts/changelog.ts';
import { readNotes } from '../scripts/release-version.ts';
import { compareVersions, parseVersion } from '../server/src/release-range.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The oldest release whose section must read as its tag has it. The sections of older ones were reworded on main after
 * their tags, which keep the text as released.
 *
 * @type {import('../server/src/release-range.ts').Version}
 */
const FIRST_UNCHANGED_RELEASE = [0, 7, 1];

// execFileSync blocks the event loop, so no test timeout can end a git that hangs: each call has its own.
const GIT_TIMEOUT_MS = 60_000;

const MAIN = `# Changelog

## 0.7.1 (2026-11-10)

- Fix: one.

## 0.6.8 (2026-11-06)

- Fix: two.
`;

const BRANCH = `# Changelog

## 0.7.2 (2026-11-20)

- Fix: three.

  Upgrade note.

## 0.7.1 (2026-11-10)

- Fix: one.
`;

/**
 * @param {string[]} args
 * @returns Git's answer in this checkout.
 */
const gitHere = (args) =>
  execFileSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT_MS,
  });

/** @returns This checkout's CHANGELOG.md, with LF line ends like `git show`'s even where core.autocrlf gave it CRLF. */
const changelogHere = async () => (await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8')).replaceAll('\r\n', '\n');

/** @returns {string[]} The release tags in this checkout from `FIRST_UNCHANGED_RELEASE` on; none outside a git checkout. */
function checkedTags() {
  try {
    return gitHere(['tag', '--list', 'v*'])
      .split('\n')
      .filter((tag) => {
        const version = parseVersion(tag.slice(1));
        return version !== null && compareVersions(version, FIRST_UNCHANGED_RELEASE) >= 0;
      });
  } catch {
    // Not a git checkout.
    return [];
  }
}

test('a section runs from its heading to the next one', () => {
  assert.equal(sectionOf(BRANCH, '0.7.2'), '## 0.7.2 (2026-11-20)\n\n- Fix: three.\n\n  Upgrade note.');
  assert.equal(sectionOf(BRANCH, '0.7.1'), '## 0.7.1 (2026-11-10)\n\n- Fix: one.');
  assert.equal(sectionOf(BRANCH, '0.7.3'), null);
});

test("a maintenance release's section goes into main's CHANGELOG.md in version order, once", () => {
  const section = sectionOf(BRANCH, '0.7.2') ?? '';
  const merged = withSection(MAIN, section, '0.7.2');
  assert.ok(merged.startsWith(`# Changelog\n\n${section}\n\n## 0.7.1 `), 'above the older ones');
  assert.equal(withSection(merged, section, '0.7.2'), merged, 'a section main already has is not added again');

  const oldest = withSection(MAIN, '## 0.6.1 (2026-10-01)\n\n- Fix: four.', '0.6.1');
  assert.ok(
    oldest.endsWith('- Fix: two.\n\n## 0.6.1 (2026-10-01)\n\n- Fix: four.\n'),
    'older than every section: last',
  );
});

test('every heading is a release with its date', () => {
  assert.deepEqual(headingProblems(MAIN), []);
  assert.deepEqual(headingProblems(BRANCH), []);
  assert.deepEqual(headingProblems('# Changelog\n'), []);
  assert.deepEqual(
    headingProblems(`# Changelog\n\n## Unreleased\n\n- New.\n\n${MAIN.slice('# Changelog\n\n'.length)}`),
    ['"## Unreleased" is not "## X.Y.Z (YYYY-MM-DD)"'],
  );
  assert.deepEqual(headingProblems(`${MAIN}\n## 0.6.7\n`), ['"## 0.6.7" is not "## X.Y.Z (YYYY-MM-DD)"']);
});

test("CHANGELOG.md's headings are in that shape", async () => {
  assert.deepEqual(headingProblems(await changelogHere()), []);
});

test("a release's section has the note files by kind, Breaking, Security and Fix first and Repository last, then by name", () => {
  const notes = [
    { name: 'b-tooling.md', text: '- Repository: tooling.\n' },
    { name: 'z-fix.md', text: '- Fix: later by name.\n' },
    { name: 'types.md', text: '- Types: a type.\n' },
    { name: 'a-fix.md', text: '- **Fix: a big one.** Act on it.\n- Fix: its second line.\n' },
    { name: 'a-tooling.md', text: '- Repository: more tooling.\n' },
    { name: 'npm.md', text: '- **Breaking (npm):** an export goes.\n\n  Upgrade note.\n' },
    { name: 'hmac.md', text: '- Security: a check.\n' },
    { name: 'docs.md', text: '- Docs: a page.\n' },
  ];
  const section = [
    '## 0.8.0 (2026-12-01)',
    '',
    '- **Breaking (npm):** an export goes.',
    '',
    '  Upgrade note.',
    '- Security: a check.',
    '- **Fix: a big one.** Act on it.',
    '- Fix: its second line.',
    '- Fix: later by name.',
    '- Docs: a page.',
    '- Types: a type.',
    '- Repository: more tooling.',
    '- Repository: tooling.',
  ].join('\n');
  assert.equal(releaseSection('0.8.0', '2026-12-01', notes), section);
  assert.equal(releaseSection('0.8.0', '2026-12-01', notes.toReversed()), section, 'whatever order they come in');
  assert.equal(releaseSection('0.8.0', '2026-12-01', []), '## 0.8.0 (2026-12-01)', 'no notes: the heading alone');
});

test('a note file holds CHANGELOG bullets and no heading', () => {
  assert.deepEqual(noteProblems({ name: 'fix.md', text: '- Fix: one.\n  More.\n- Fix: two.\n' }), []);
  assert.deepEqual(noteProblems({ name: 'fix.txt', text: 'Fixed it.\n' }), [
    "fix.txt: a note file's name ends in .md",
    'fix.txt: a note starts with a "- " bullet',
  ]);
  assert.deepEqual(
    noteProblems({ name: 'npm.md', text: '- Fix: one.\n- **Breaking (npm):** two.\n  - Fix: nested.\n' }),
    ["npm.md: a note's bullets are all one kind (it has Fix, Breaking): split it, one file per kind"],
  );
  assert.deepEqual(noteProblems({ name: 'fix.md', text: '## 0.8.0 (2026-12-01)\n\n- Fix: one.\n' }), [
    'fix.md: a note starts with a "- " bullet',
    'fix.md: a note has no heading; the release writes it',
  ]);
});

test('the note files in .changes/ are notes', async () => {
  assert.deepEqual((await readNotes(ROOT)).flatMap(noteProblems), []);
});

// A merge can put a branch's notes into a section that is already released, without a conflict. The tag keeps the
// release's notes as they were, and the GitHub release is cut from it.
test("every released section in CHANGELOG.md reads as at the release's tag", async (t) => {
  const tags = checkedTags();
  if (!tags.length) {
    if (process.env['CI']) assert.fail('no release tags in this checkout: fetch the tags');
    t.skip('no release tags in this checkout (git fetch --tags runs it)');
    return;
  }
  // A checkout with core.autocrlf has CRLF line ends, which `git show` doesn't.
  const changelog = await changelogHere();
  const changed = tags.filter((tag) => {
    const version = tag.slice(1);
    const released = sectionOf(gitHere(['show', `${tag}:CHANGELOG.md`]), version);
    const here = sectionOf(changelog, version);
    // A branch that hasn't merged the release yet has no section for it.
    return released !== null && here !== null && here !== released;
  });
  assert.deepEqual(changed, [], 'move the lines added to these sections into note files in .changes/');
});
