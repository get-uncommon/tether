// A workflow step that runs one of this repository's scripts needs the packages that script imports, through any of its
// own imports. A step that runs such a script before its job's `npm ci` fails on GitHub only: the release rehearsal
// once ran scripts/release.ts, which reaches `yaml`, before installing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importsOf, treeReader } from '../scripts/release-tooling.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_RUN = /node\b[^\n]*?\b(scripts\/[\w./-]+\.ts)\b/g;

/** @param {string} file Relative to the root. */
const packagesReachedFrom = async (file) => (await importsOf(treeReader(ROOT), [file])).packages;

/**
 * Each job of a workflow, as its text.
 *
 * @param {string} workflow
 * @returns {[string, string][]}
 */
function jobsOf(workflow) {
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
  return jobs
    .split(/^ {2}(?=[\w-]+:$)/m)
    .slice(1)
    .map((job) => [job.slice(0, job.indexOf(':')), job]);
}

test("a workflow step runs a repository script that imports packages only after its job's npm ci", async () => {
  const folder = join(ROOT, '.github/workflows');
  /** @type {string[]} */
  const problems = [];
  let checked = 0;
  for (const name of (await readdir(folder)).filter((file) => file.endsWith('.yml'))) {
    const workflow = await readFile(join(folder, name), 'utf8');
    for (const [job, text] of jobsOf(workflow)) {
      const install = text.search(/^\s*(?:- )?run: npm ci\b/m);
      for (const match of text.matchAll(SCRIPT_RUN)) {
        if (text.lastIndexOf('#', match.index) > text.lastIndexOf('\n', match.index)) continue; // a comment
        checked++;
        const packages = await packagesReachedFrom(match[1] ?? '');
        if (packages.length > 0 && (install === -1 || install > match.index)) {
          problems.push(`${name} ${job}: ${match[1] ?? ''} needs ${packages.join(', ')} before npm ci`);
        }
      }
    }
  }
  assert.ok(checked > 0, 'the workflows run repository scripts');
  assert.deepEqual(problems, []);
});

test('the import walk finds a package reached through another of our files', async () => {
  assert.ok(
    (await packagesReachedFrom('scripts/release.ts')).includes('yaml'),
    'release.ts reaches yaml through the steps it imports and github-runs.ts',
  );
  assert.deepEqual(await packagesReachedFrom('scripts/lint-workflows.ts'), []);
});
