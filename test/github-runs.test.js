// How `npm run release` reads GitHub's answers about the ci and release-rehearsal runs of the commit it releases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { getFileInfo } from 'prettier';
import { NOTES_FOLDER } from '../scripts/changelog.ts';
import { newestRun, rehearsalCommits, rehearsalPathspecs } from '../scripts/github-runs.ts';
import { RELEASE_FILES } from '../scripts/release-version.ts';
import { tempFolder } from '../server/test/mocks.js';
import { isolatedGit } from './fixtures.js';

const ROOT = join(import.meta.dirname, '..');
const URL_OF_RUN = 'https://github.com/o/tether/actions/runs/1';

test("a commit's newest run decides, whatever the older ones did", () => {
  const run = (/** @type {string} */ status, /** @type {string | null} */ conclusion) => ({
    status,
    conclusion,
    url: URL_OF_RUN,
  });
  assert.deepEqual(newestRun('[]'), { kind: 'missing' });
  assert.deepEqual(newestRun(JSON.stringify([run('in_progress', null), run('completed', 'success')])), {
    kind: 'running',
    url: URL_OF_RUN,
  });
  assert.deepEqual(newestRun(JSON.stringify([run('completed', 'failure'), run('completed', 'success')])), {
    kind: 'failed',
    url: URL_OF_RUN,
  });
  assert.deepEqual(newestRun(JSON.stringify([run('completed', 'success'), run('completed', 'failure')])), {
    kind: 'passed',
  });
});

test('the head of a pull request merged into the branch stands for the commit it was merged by', () => {
  const pull = (/** @type {string | null} */ mergedAt, /** @type {string} */ base, /** @type {string} */ head) => ({
    merged_at: mergedAt,
    base: { ref: base },
    head: { sha: head },
  });
  const pulls = JSON.stringify([
    pull('2026-11-01T00:00:00Z', 'main', 'head-merged'),
    pull(null, 'main', 'head-open'),
    pull('2026-11-01T00:00:00Z', 'release/0.8', 'head-elsewhere'),
  ]);
  assert.deepEqual(rehearsalCommits('merge', 'main', pulls), ['merge', 'head-merged']);
  assert.deepEqual(rehearsalCommits('pushed', 'main', '[]'), ['pushed']);
});

test("the rehearsal's paths, as pathspecs, find the newest commit that changes what it tests", async (t) => {
  const workflow = await readFile(new URL('../.github/workflows/release-rehearsal.yml', import.meta.url), 'utf8');
  const pathspecs = rehearsalPathspecs(workflow);
  assert.ok(pathspecs.includes(':(glob)src/**'));
  assert.ok(pathspecs.includes(':(glob)package.json'));

  const repository = await tempFolder(t, 'tether-rehearsal-');
  const git = isolatedGit(repository);
  git('init', '--quiet', '--initial-branch=main');
  const commit = async (/** @type {string} */ path, /** @type {string} */ message) => {
    await mkdir(join(repository, path, '..'), { recursive: true });
    await writeFile(join(repository, path), message);
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  await commit('src/deep/a.ts', 'code');
  const tested = await commit('docs/guide.md', 'docs');
  await commit('.claude/skills/code-clarity/SKILL.md', 'skill');
  await commit('LICENSE', 'license');
  // release.ts's own lookup: the agents' skills and the license are no file the gate reads.
  assert.equal(git('log', '-1', '--first-parent', '--format=%H', 'HEAD', '--', ...pathspecs), tested);
});

/**
 * What the gate's tools read besides the files they check: Prettier's ignore files, and the lockfile `npm ci` installs.
 */
const TOOL_INPUTS = ['.gitignore', '.prettierignore', 'package-lock.json'];

test("the rehearsal's paths cover every file the gate reads, so a release can't stand on an older commit's rehearsal", async () => {
  const workflow = await readFile(new URL('../.github/workflows/release-rehearsal.yml', import.meta.url), 'utf8');
  const pathspecs = rehearsalPathspecs(workflow);
  const git = isolatedGit(ROOT);
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  const covered = new Set(
    git('ls-files', '-z', '--', ...pathspecs)
      .split('\0')
      .filter(Boolean),
  );
  const eslint = new ESLint({ cwd: ROOT });
  // A top-level entry the gate's own code names, which the tests and scripts may read any file of.
  // This file's own paths are a scratch repository's.
  const gateCode = tracked.filter(
    (file) => /^(test|server\/test)\/.*\.js$|^scripts\/.*\.ts$/.test(file) && file !== 'test/github-runs.test.js',
  );
  const sources = await Promise.all(gateCode.map((file) => readFile(join(ROOT, file), 'utf8')));
  const named = (/** @type {string} */ entry) => {
    const name = new RegExp(`["'\`/(]${entry.replaceAll('.', '[.]')}(?:["'\`/)]|$)`, 'm');
    return sources.some((source) => name.test(source));
  };
  const namedEntries = new Set([...new Set(tracked.map((file) => file.split('/')[0] ?? ''))].filter(named));
  const read = [];
  for (const file of tracked) {
    const path = join(ROOT, file);
    const prettier = await getFileInfo(path, {
      ignorePath: ['.gitignore', '.prettierignore'].map((f) => join(ROOT, f)),
    });
    if (
      (!prettier.ignored && prettier.inferredParser !== null) ||
      !(await eslint.isPathIgnored(path)) ||
      TOOL_INPUTS.includes(file) ||
      RELEASE_FILES.includes(file) ||
      namedEntries.has(file.split('/')[0] ?? '')
    )
      read.push(file);
  }
  assert.deepEqual(
    read.filter((file) => !covered.has(file)),
    [],
    'files the gate reads that change no rehearsal path',
  );
  // The rewrite reads the note files, which a pull request adds and a release deletes.
  assert.ok(pathspecs.includes(`:(glob)${NOTES_FOLDER}/**`));
});
