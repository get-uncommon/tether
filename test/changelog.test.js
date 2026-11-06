// A maintenance release's CHANGELOG.md section, which the release script adds to main's CHANGELOG.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionOf, withSection } from '../scripts/changelog.ts';

const MAIN = `# Changelog

## 0.8.0 (unreleased)

- New: a feature.

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

test('a release section runs from its heading to the next one', () => {
  assert.equal(sectionOf(BRANCH, '0.7.2'), '## 0.7.2 (2026-11-20)\n\n- Fix: three.\n\n  Upgrade note.');
  assert.equal(sectionOf(BRANCH, '0.7.1'), '## 0.7.1 (2026-11-10)\n\n- Fix: one.');
  assert.equal(sectionOf(BRANCH, '0.7.3'), null);
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
