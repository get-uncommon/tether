// What a release needs in the tree it runs in, which a maintenance branch made from an older tag copies from main: the
// list docs/reference.md gives, and the check `npm run release` makes first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseTooling, releaseToolingProblems, treeReader, workflowRuns } from '../scripts/release-tooling.ts';
import { tempFolder } from '../server/test/mocks.js';
import { isolatedGit } from './fixtures.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} file Relative to the repository root. */
const isShipped = (file) => file.startsWith('src/') || file.startsWith('server/');

test('the maintenance-release docs list every file the release needs from main, outside the shipped code an older tag has', async () => {
  const reference = await readFile(join(ROOT, 'docs/reference.md'), 'utf8');
  const start = reference.indexOf('**Maintenance releases:**');
  const paragraph = reference.slice(start, reference.indexOf('\n## ', start));
  const listed = [...paragraph.matchAll(/`((?:scripts|\.github|\.config)\/[^`\s]+)`/g)].map((match) => match[1]);
  const { files } = await releaseTooling(treeReader(ROOT));
  assert.deepEqual(
    [...new Set(listed)].sort(),
    files.filter((file) => !isShipped(file)),
  );
  assert.ok(files.includes('scripts/dist-guard.ts') && files.includes('scripts/release-steps.ts'));
});

test('a tree at main has everything the release needs', async () => {
  assert.deepEqual(await releaseToolingProblems(ROOT), []);
});

test("a workflow's runs are its steps' node scripts and npm scripts, not a comment's or a sentence's", () => {
  const workflow = [
    '# Runs scripts/old.ts by node, and npm run old.',
    'jobs:',
    '  check:',
    '    steps:',
    '      - run: node --experimental-strip-types scripts/guard.ts "$BASE"',
    '      - run: npm run lint:workflows && npm run check',
    '      - run: echo "::error::differs from a fresh npm run build: rebuild" && node server/scripts/update.ts',
  ].join('\n');
  assert.deepEqual(workflowRuns(workflow), {
    scripts: ['scripts/guard.ts'],
    npmScripts: ['build', 'check', 'lint:workflows'],
  });
});

/**
 * @param {string} root
 * @param {Record<string, string>} files
 */
async function writeFiles(root, files) {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
}

test("a branch from an older tag hears every file, package and npm script it lacks, through main's copies' imports", async (t) => {
  const repo = await tempFolder(t, 'tether-release-tooling-');
  const git = isolatedGit(repo);
  git('init', '-q', '-b', 'main');
  const shared = { 'server/src/json.ts': 'export const field = 1;\n' };
  await writeFiles(repo, {
    ...shared,
    'package.json': JSON.stringify({ scripts: { check: 'x' }, devDependencies: {} }),
  });
  git('add', '-A');
  git('commit', '-q', '-m', 'Old');
  git('tag', 'v0.1.0');
  const release = "import { steps } from './release-steps.ts';\nawait import('./later.ts');\n";
  await writeFiles(repo, {
    'scripts/release.ts': release,
    'scripts/release-steps.ts': "import { parse } from 'yaml';\nimport { field } from '../server/src/json.ts';\n",
    'scripts/later.ts': '',
    'scripts/guard.ts': "import './guard-rules.ts';\n",
    'scripts/guard-rules.ts': '',
    '.github/workflows/ci.yml': 'jobs:\n  dist:\n    steps:\n      - run: node scripts/guard.ts && npm run smoke\n',
    '.github/workflows/release.yml': 'jobs: {}\n',
    '.github/workflows/release-rehearsal.yml': 'jobs: {}\n',
  });
  git('add', '-A');
  git('commit', '-q', '-m', 'Main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '--detach', 'v0.1.0');
  // The release script is the one file copied so far: it is what the owner runs.
  await writeFiles(repo, { 'scripts/release.ts': release });

  assert.deepEqual(await releaseToolingProblems(repo), [
    'missing files, which main has: git checkout origin/main -- .github/workflows/ci.yml ' +
      '.github/workflows/release-rehearsal.yml .github/workflows/release.yml scripts/guard-rules.ts scripts/guard.ts ' +
      'scripts/later.ts scripts/release-steps.ts',
    "package.json doesn't list the package yaml",
    'package.json has no "smoke" script',
  ]);
});
