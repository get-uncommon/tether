// A workflow step that runs one of this repository's scripts needs the packages that script imports, through any of its
// own imports. A step that runs such a script before its job's `npm ci` fails on GitHub only: the release rehearsal
// once ran scripts/release.ts, which reaches `yaml`, before installing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT = /^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
const SCRIPT_RUN = /node\b[^\n]*?\b(scripts\/[\w./-]+\.ts)\b/g;

/**
 * The packages a module reaches through its static imports, following this repository's own files.
 *
 * @param {string} file An absolute path.
 * @param {Set<string>} [seen]
 * @returns {Promise<Set<string>>}
 */
async function packagesReachedFrom(file, seen = new Set()) {
  /** @type {Set<string>} */
  const packages = new Set();
  if (seen.has(file)) return packages;
  seen.add(file);
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(IMPORT)) {
    const specifier = match[1] ?? match[2] ?? '';
    if (specifier.startsWith('.')) {
      if (!/\.[cm]?[jt]s$/.test(specifier)) continue; // JSON and other data files import no code
      for (const name of await packagesReachedFrom(resolve(dirname(file), specifier), seen)) packages.add(name);
    } else if (!specifier.startsWith('node:') && !builtinModules.includes(specifier)) {
      packages.add(specifier);
    }
  }
  return packages;
}

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
        const packages = [...(await packagesReachedFrom(join(ROOT, match[1] ?? '')))];
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
  const packages = await packagesReachedFrom(join(ROOT, 'scripts/release.ts'));
  assert.ok(packages.has('yaml'), 'release.ts reaches yaml through github-runs.ts');
  assert.deepEqual([...(await packagesReachedFrom(join(ROOT, 'scripts/lint-workflows.ts')))], []);
});
