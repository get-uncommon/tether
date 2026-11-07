// The pre-push hook's choice between the whole gate and the starter's narrow check, from the refs git pushes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STARTER_FILES, gitHistory, pushCheck } from '../scripts/push-check.ts';
import { tempFolder } from '../server/test/mocks.js';
import { isolatedGit } from './fixtures.js';

const LOCAL = '1'.repeat(40);
const REMOTE = '2'.repeat(40);
const NONE = '0'.repeat(40);
const PUSH_TO_MAIN = `HEAD ${LOCAL} refs/heads/main ${REMOTE}\n`;

/**
 * A history in which the push to main only adds commits, whose files and tree change are `files`, and which knows no
 * other commit.
 *
 * @param {string[]} files
 * @param {Partial<import('../scripts/push-check.ts').History>} [over]
 * @returns {import('../scripts/push-check.ts').History}
 */
function history(files, over = {}) {
  const known = (/** @type {string} */ from, /** @type {string} */ to) => from === REMOTE && to === LOCAL;
  return {
    isAncestor: (from, to) => (known(from, to) ? true : null),
    treeFiles: (from, to) => (known(from, to) ? files : null),
    commitFiles: (from, to) => (known(from, to) ? files : null),
    ...over,
  };
}

test("a push that only adds commits changing only the starter's package.json and lockfile gets the narrow check", () => {
  assert.deepEqual(pushCheck(PUSH_TO_MAIN, history([...STARTER_FILES])), { kind: 'starter' });
});

test('a push with a commit that changes any other file runs the whole gate', () => {
  const files = ['examples/astro/package.json', 'src/cart.ts'];
  assert.deepEqual(pushCheck(PUSH_TO_MAIN, history(files)), {
    kind: 'gate',
    reason: 'the pushed tree changes src/cart.ts',
  });
  const commitsOnly = history([...STARTER_FILES], { commitFiles: () => files });
  assert.deepEqual(pushCheck(PUSH_TO_MAIN, commitsOnly), {
    kind: 'gate',
    reason: 'a pushed commit changes src/cart.ts',
  });
});

test("a push that rewrites the remote's history runs the whole gate, whatever its own commits change", () => {
  const forced = history([...STARTER_FILES], { isAncestor: () => false });
  assert.deepEqual(pushCheck(PUSH_TO_MAIN, forced), {
    kind: 'gate',
    reason: 'the push rewrites the history of refs/heads/main',
  });
});

test('a push git cannot answer for runs the whole gate', () => {
  const unknown = history([], { isAncestor: () => null });
  assert.equal(pushCheck(PUSH_TO_MAIN, unknown).kind, 'gate', "the remote's commit isn't in this clone");
  const unlisted = history([], { treeFiles: () => null });
  assert.equal(pushCheck(PUSH_TO_MAIN, unlisted).kind, 'gate', "the tree can't be compared");
  const starter = history([...STARTER_FILES]);
  assert.equal(pushCheck(`HEAD ${LOCAL} refs/heads/new ${NONE}\n`, starter).kind, 'gate', 'a new branch');
  assert.equal(pushCheck('', starter).kind, 'gate', 'no refs on stdin');
  assert.equal(pushCheck('HEAD', starter).kind, 'gate', 'an unreadable line');
});

test('a deleted ref pushes no commit to check', () => {
  const refs = `(delete) ${NONE} refs/heads/old ${REMOTE}\n${PUSH_TO_MAIN}`;
  assert.deepEqual(pushCheck(refs, history(['examples/astro/package-lock.json'])), { kind: 'starter' });
});

test('in a real repository, a force-push of a starter commit over a code change runs the whole gate', async (t) => {
  const repository = await tempFolder(t, 'tether-push-check-');
  const git = isolatedGit(repository);
  const commit = async (/** @type {string} */ path, /** @type {string} */ message) => {
    await mkdir(join(repository, path, '..'), { recursive: true });
    await writeFile(join(repository, path), message);
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '--quiet', '--initial-branch=main');
  const base = await commit('src/cart.ts', 'base');
  const code = await commit('src/cart.ts', 'code');
  git('checkout', '--quiet', '-b', 'starter', base);
  const starter = await commit('examples/astro/package.json', 'starter');
  const push = (/** @type {string} */ remote) => `refs/heads/main ${starter} refs/heads/main ${remote}\n`;
  const repo = gitHistory(repository);

  assert.deepEqual(pushCheck(push(base), repo), { kind: 'starter' }, 'a fast-forward');
  assert.deepEqual(pushCheck(push(code), repo), {
    kind: 'gate',
    reason: 'the push rewrites the history of refs/heads/main',
  });
  assert.equal(pushCheck(push('3'.repeat(40)), repo).kind, 'gate', 'a commit this clone lacks');

  // A rename out of src/ into the starter's files shows both paths.
  git('checkout', '--quiet', '-b', 'renamed', base);
  await mkdir(join(repository, 'examples/astro'), { recursive: true });
  git('mv', 'src/cart.ts', 'examples/astro/package.json');
  git('commit', '--quiet', '-m', 'rename');
  const renamed = git('rev-parse', 'HEAD');
  assert.deepEqual(pushCheck(`refs/heads/main ${renamed} refs/heads/main ${base}\n`, repo), {
    kind: 'gate',
    reason: 'the pushed tree changes src/cart.ts',
  });
});
