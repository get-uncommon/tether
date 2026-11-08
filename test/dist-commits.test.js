// CI's dist guard: only a release commit, by content as well as subject, changes dist/; merges are checked too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { distProblems, gitDistHistory } from '../scripts/dist-commits.ts';
import { tempFolder } from '../server/test/mocks.js';
import { isolatedGit } from './fixtures.js';

/** @param {import('node:test').TestContext} t */
async function scratchRepository(t) {
  const repository = await tempFolder(t, 'tether-dist-commits-');
  const git = isolatedGit(repository);
  /**
   * @param {string} message
   * @param {Record<string, string>} files Path to content.
   */
  const commit = async (message, files) => {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(repository, path)), { recursive: true });
      await writeFile(join(repository, path), content);
    }
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '--quiet', '--initial-branch=main');
  const pkg = (/** @type {string} */ version) => `{ "name": "tether", "version": "${version}" }\n`;
  const base = await commit('Base', { 'package.json': pkg('0.9.1'), 'dist/tether.js': 'one', 'src/cart.ts': 'a' });
  return { repository, git, commit, pkg, base, history: gitDistHistory(repository) };
}

/** @param {string[]} problems */
const reasons = (problems) => problems.map((problem) => problem.replace(/^[0-9a-f]{12} /, ''));

test('a release commit changes dist/ with the version files; a commit that changes nothing in dist/ passes', async (t) => {
  const { commit, pkg, base, history } = await scratchRepository(t);
  await commit('Fix the cart', { 'src/cart.ts': 'b' });
  const release = await commit('Tether 0.9.2', {
    'package.json': pkg('0.9.2'),
    'CHANGELOG.md': '## 0.9.2',
    'package-lock.json': '{}',
    'dist/tether.js': 'two',
  });
  assert.deepEqual(distProblems(base, release, history), []);
});

test('a release commit deletes the note files it wrote into CHANGELOG.md, and adds none', async (t) => {
  const { git, commit, pkg, history } = await scratchRepository(t);
  const notes = await commit('Fix the cart', { '.changes/cart.md': '- Fix: the cart.\n' });
  git('rm', '--quiet', '.changes/cart.md');
  const release = await commit('Tether 0.9.2', {
    'package.json': pkg('0.9.2'),
    'CHANGELOG.md': '## 0.9.2',
    'dist/tether.js': 'two',
  });
  assert.deepEqual(distProblems(notes, release, history), []);

  const adding = await commit('Tether 0.9.3', {
    'package.json': pkg('0.9.3'),
    '.changes/next.md': '- Fix: next.\n',
    'dist/tether.js': 'three',
  });
  assert.deepEqual(reasons(distProblems(release, adding, history)), ['Tether 0.9.3: it also changes .changes/next.md']);
});

test('a release commit may delete a note file whose name is not ASCII, which git quotes without -z', async (t) => {
  const { git, commit, pkg, history } = await scratchRepository(t);
  const notes = await commit('Fix the café', { '.changes/café.md': '- Fix: the café.\n' });
  git('rm', '--quiet', '.changes/café.md');
  const release = await commit('Tether 0.9.2', { 'package.json': pkg('0.9.2'), 'dist/tether.js': 'two' });
  assert.deepEqual(distProblems(notes, release, history), []);
});

test('a commit titled as a release is not one when it changes other files or leaves the version', async (t) => {
  const { commit, pkg, base, history } = await scratchRepository(t);
  await commit('Tether 0.9.2', { 'package.json': pkg('0.9.2'), 'dist/tether.js': 'two', 'src/cart.ts': 'b' });
  await commit('Tether 0.9.3', { 'dist/tether.js': 'three' });
  const head = await commit('Rebuild', { 'dist/tether.js': 'four' });
  assert.deepEqual(reasons(distProblems(base, head, history)), [
    'Rebuild: its subject is not "Tether X.Y.Z"',
    "Tether 0.9.3: it doesn't move package.json to 0.9.3",
    'Tether 0.9.2: it also changes src/cart.ts',
  ]);
});

test("a merge that takes the base branch's dist/ passes, and one that edits dist/ itself fails", async (t) => {
  const { repository, git, commit, pkg, base, history } = await scratchRepository(t);
  await commit('Tether 0.9.2', { 'package.json': pkg('0.9.2'), 'dist/tether.js': 'two' });
  const main = git('rev-parse', 'HEAD');
  git('checkout', '--quiet', '-b', 'feature', base);
  await commit('Fix the cart', { 'src/cart.ts': 'b' });
  git('merge', '--quiet', '--no-edit', 'main');
  assert.deepEqual(distProblems(main, git('rev-parse', 'HEAD'), history), [], "dist/ is main's as it is");

  await writeFile(join(repository, 'dist/tether.js'), 'by hand');
  git('commit', '--quiet', '--amend', '-a', '--no-edit');
  const problems = reasons(distProblems(main, git('rev-parse', 'HEAD'), history));
  assert.deepEqual(problems, ['Merge branch \'main\' into feature: its subject is not "Tether X.Y.Z"']);
});

test('a range git cannot list is a problem, not a pass', () => {
  const history = {
    commits: () => null,
    changedFiles: () => null,
    packageVersion: () => null,
    distTree: () => null,
  };
  assert.deepEqual(distProblems('a', 'b', history), ["the commits of a..b can't be listed"]);
  const unlisted = { ...history, commits: () => [{ sha: 'c'.repeat(40), parents: ['a'], subject: 'Fix' }] };
  assert.deepEqual(reasons(distProblems('a', 'c', unlisted)), ["Fix: the files it changes can't be listed"]);
});

test('the dist job runs the guard over the pull request', async () => {
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /run: node --experimental-strip-types scripts\/dist-guard\.ts "\$BASE_SHA" "\$HEAD_SHA"\n/);
});
