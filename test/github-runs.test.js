// How `npm run release` reads GitHub's answers about the ci and release-rehearsal runs of the commit it releases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newestRun, rehearsalCommits, rehearsalPathspecs } from '../scripts/github-runs.ts';

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

  const repository = await mkdtemp(join(tmpdir(), 'tether-rehearsal-'));
  t.after(() => rm(repository, { recursive: true, force: true }));
  const git = (/** @type {string[]} */ ...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
  git('init', '--quiet');
  const commit = async (/** @type {string} */ path, /** @type {string} */ message) => {
    await mkdir(join(repository, path, '..'), { recursive: true });
    await writeFile(join(repository, path), message);
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const tested = await commit('src/deep/a.ts', 'code');
  await commit('docs/guide.md', 'docs');
  await commit('examples/astro/package.json', 'starter');
  // release.ts's own lookup: the docs and the starter are no change the rehearsal tests.
  assert.equal(git('log', '-1', '--first-parent', '--format=%H', 'HEAD', '--', ...pathspecs), tested);
});
