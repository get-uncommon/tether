// The pre-push hook's choice between the whole gate and the starter's narrow check, from the refs git pushes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushCheck } from '../scripts/push-check.ts';

const LOCAL = '1'.repeat(40);
const REMOTE = '2'.repeat(40);
const NONE = '0'.repeat(40);
const PUSH_TO_MAIN = `HEAD ${LOCAL} refs/heads/main ${REMOTE}\n`;

/** @param {Record<string, string[]>} files The files changed in each range git can list. */
const listing = (files) => (/** @type {string} */ range) => files[range] ?? null;

test("a push whose commits change only the starter's package.json and lockfile gets the narrow check", () => {
  const files = listing({
    [`${REMOTE}..${LOCAL}`]: ['examples/astro/package.json', 'examples/astro/package-lock.json'],
  });
  assert.deepEqual(pushCheck(PUSH_TO_MAIN, files), { kind: 'starter' });
});

test('a push with a commit that changes any other file runs the whole gate', () => {
  const files = listing({ [`${REMOTE}..${LOCAL}`]: ['examples/astro/package.json', 'src/cart.ts'] });
  assert.deepEqual(pushCheck(PUSH_TO_MAIN, files), { kind: 'gate', reason: 'a pushed commit changes src/cart.ts' });
});

test('a push whose commits git cannot list runs the whole gate', () => {
  const unlisted = listing({});
  assert.equal(pushCheck(PUSH_TO_MAIN, unlisted).kind, 'gate', "the remote's commit isn't in this clone");
  assert.equal(pushCheck(`HEAD ${LOCAL} refs/heads/new ${NONE}\n`, unlisted).kind, 'gate', 'a new branch');
  assert.equal(pushCheck('', unlisted).kind, 'gate', 'no refs on stdin');
  assert.equal(pushCheck('HEAD', unlisted).kind, 'gate', 'an unreadable line');
});

test('a deleted ref pushes no commit to check', () => {
  const files = listing({ [`${REMOTE}..${LOCAL}`]: ['examples/astro/package-lock.json'] });
  const refs = `(delete) ${NONE} refs/heads/old ${REMOTE}\n${PUSH_TO_MAIN}`;
  assert.deepEqual(pushCheck(refs, files), { kind: 'starter' });
});
