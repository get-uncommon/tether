// CHANGELOG.md's sections: the notes under `## Unreleased`, each release's section as its tag has it, and a
// maintenance release's section, which the release script adds to main's CHANGELOG.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headingProblems, sectionOf, withSection } from '../scripts/changelog.ts';
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

## Unreleased

- New: a feature.

## 0.7.1 (2026-11-10)

- Fix: one.

## 0.6.8 (2026-11-06)

- Fix: two.
`;

const BRANCH = `# Changelog

## Unreleased

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

test('a section runs from its heading to the next one, the notes under "## Unreleased" included', () => {
  assert.equal(sectionOf(BRANCH, '0.7.2'), '## 0.7.2 (2026-11-20)\n\n- Fix: three.\n\n  Upgrade note.');
  assert.equal(sectionOf(BRANCH, '0.7.1'), '## 0.7.1 (2026-11-10)\n\n- Fix: one.');
  assert.equal(sectionOf(BRANCH, '0.7.3'), null);
  assert.equal(sectionOf(BRANCH, 'Unreleased'), '## Unreleased', 'no notes yet');
  assert.equal(sectionOf(MAIN, 'Unreleased'), '## Unreleased\n\n- New: a feature.');
});

test("a maintenance release's section goes into main's CHANGELOG.md in version order, once", () => {
  const section = sectionOf(BRANCH, '0.7.2') ?? '';
  const merged = withSection(MAIN, section, '0.7.2');
  assert.ok(merged.includes(`- New: a feature.\n\n${section}\n\n## 0.7.1 `), 'between its neighbours');
  assert.equal(withSection(merged, section, '0.7.2'), merged, 'a section main already has is not added again');

  const oldest = withSection(MAIN, '## 0.6.1 (2026-10-01)\n\n- Fix: four.', '0.6.1');
  assert.ok(
    oldest.endsWith('- Fix: two.\n\n## 0.6.1 (2026-10-01)\n\n- Fix: four.\n'),
    'older than every section: last',
  );
});

test('"## Unreleased" comes first, and every other heading is a release with its date', () => {
  assert.deepEqual(headingProblems(MAIN), []);
  assert.deepEqual(headingProblems(BRANCH), []);
  assert.deepEqual(headingProblems(MAIN.replace('## Unreleased', '## 0.8.0 (unreleased)')), [
    '"## Unreleased" is not the first section',
  ]);
  assert.deepEqual(headingProblems(`${MAIN}\n## Unreleased\n\n## 0.6.7\n`), [
    '"## Unreleased" is not "## X.Y.Z (YYYY-MM-DD)"',
    '"## 0.6.7" is not "## X.Y.Z (YYYY-MM-DD)"',
  ]);
  assert.deepEqual(headingProblems('# Changelog\n'), ['"## Unreleased" is not the first section']);
});

test("CHANGELOG.md's headings are in that shape", async () => {
  assert.deepEqual(headingProblems(await changelogHere()), []);
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
  assert.deepEqual(changed, [], 'move the lines added to these sections under "## Unreleased"');
});
