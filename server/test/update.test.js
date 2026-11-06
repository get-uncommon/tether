// The updater a deployed copy runs (scripts/update-tether.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listTags, pickVersion, releaseCommit } from '../scripts/update-tether.mjs';

/**
 * The shipped workflow's hash. A copy keeps the workflow it was made with, because an Action's token can't change a
 * workflow file, so every version of the script must keep the contract that all shipped workflows rely on (see the
 * output test below). The hash makes a change to the workflow a deliberate one, checked against that contract.
 */
const WORKFLOW_HASH = '30da9f16851f';

const TAGS = ['v0.1.0', 'v0.2.0', 'v0.3.0', 'v0.3.1', 'v0.3.3', 'v0.3.2', 'v0.4.0', 'v1.0.0', 'not-a-version'];

test('version ranges work like jsDelivr', () => {
  assert.equal(pickVersion(TAGS, '0.3'), '0.3.3');
  assert.equal(pickVersion(TAGS, '0.3.1'), '0.3.1');
  assert.equal(pickVersion(TAGS, 'v0.3.1'), '0.3.1');
  assert.equal(pickVersion(TAGS, 'latest'), '1.0.0');
  assert.equal(pickVersion(TAGS, '0'), '0.4.0');
  assert.equal(pickVersion(TAGS, '0.9'), null);
  assert.throws(() => pickVersion(TAGS, '^0.3'), /TETHER_VERSION must be/);
});

test('only v tags are releases: a tag without the v is never picked, since it could not be installed', () => {
  assert.equal(pickVersion(['v0.6.0', '0.7.0'], 'latest'), '0.6.0');
  assert.equal(pickVersion(['0.7.0'], '0.7'), null);
});

test('updating a copy replaces the code and keeps config, wrangler ids and TETHER_VERSION', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const base = await mkdtemp(join(tmpdir(), 'tether-update-'));
  const copy = join(base, 'copy');
  const release = join(base, 'release');
  // An "old" deployed copy: older version, customized mapping, Cloudflare's KV id.
  await mkdir(copy);
  await cp(join(root, 'scripts'), join(copy, 'scripts'), { recursive: true });
  await cp(join(root, 'src'), join(copy, 'src'), { recursive: true });
  await writeFile(join(copy, 'src', 'old.js'), 'old');
  await writeFile(
    join(copy, 'package.json'),
    JSON.stringify({ name: '@occluze/tether-sync', version: '0.3.1', type: 'module' }),
  );
  await writeFile(
    join(copy, 'tether-sync.config.js'),
    'export default { fields: { material: "metafield:custom.material" } };',
  );
  await writeFile(join(copy, 'wrangler.jsonc'), '{ "kv_namespaces": [{ "binding": "TETHER_SYNC", "id": "kv-123" }] }');
  await writeFile(join(copy, 'TETHER_VERSION'), '0.3\n');
  // The "new" release: this checkout.
  await cp(root, release, { recursive: true, filter: (p) => !p.includes('node_modules') });

  const out = execFileSync('node', [join(copy, 'scripts', 'update-tether.mjs'), '--from', release], {
    encoding: 'utf8',
  });
  const version = JSON.parse(await readFile(join(release, 'package.json'), 'utf8')).version;
  assert.match(out, new RegExp(`updated=${version.replace(/\./g, '\\.')}`));
  assert.ok(existsSync(join(copy, 'src', 'entry.js')), 'new code in place');
  assert.ok(!existsSync(join(copy, 'src', 'old.js')), 'old code removed');
  assert.match(
    await readFile(join(copy, 'tether-sync.config.js'), 'utf8'),
    /metafield:custom\.material/,
    'mapping kept',
  );
  assert.match(await readFile(join(copy, 'wrangler.jsonc'), 'utf8'), /kv-123/, 'Cloudflare ids kept');
  assert.equal((await readFile(join(copy, 'TETHER_VERSION'), 'utf8')).trim(), '0.3');
  assert.ok(
    !existsSync(join(copy, '.github')),
    'workflow files are never touched (GitHub refuses that from an Action)',
  );
  assert.ok(existsSync(join(copy, 'scripts', 'update-tether.mjs')), 'the updater script updates itself');
  assert.deepEqual(
    (await readdir(copy)).filter((name) => name.startsWith('.tether-update-')),
    [],
    'the staging folder is removed',
  );

  const again = execFileSync('node', [join(copy, 'scripts', 'update-tether.mjs'), '--from', release], {
    encoding: 'utf8',
  });
  assert.match(again, /up to date/);
  assert.equal(workflowVersion(out), version, 'the workflow reads the new version');
  assert.equal(workflowVersion(again), '', 'an empty version tells every workflow there is nothing to commit');
});

/**
 * What every shipped workflow, old and new, takes from the script's output: the value of the last `updated=` line
 * (`grep '^updated=' | tail -1 | cut -d= -f2`), empty when nothing changed.
 *
 * @param {string} output
 */
function workflowVersion(output) {
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith('updated='));
  assert.ok(lines.length, 'the output has an updated= line');
  return lines.at(-1).split('=')[1];
}

test('the workflow keeps to the contract: the script path, the updated= line, test/ and src/entry.js', async () => {
  const workflow = await readFile(new URL('../.github/workflows/update-tether.yml', import.meta.url), 'utf8');
  for (const command of [
    'node scripts/update-tether.mjs | tee update.log',
    `grep '^updated=' update.log | tail -1 | cut -d= -f2`,
    'node --test test/*.test.js',
    "import('./src/entry.js')",
  ]) {
    assert.ok(workflow.includes(command), command);
  }
});

test('a failed update exits non-zero, and --from without a folder is refused', () => {
  const script = fileURLToPath(new URL('../scripts/update-tether.mjs', import.meta.url));
  assert.throws(
    () => execFileSync('node', [script, '--from'], { encoding: 'utf8', stdio: 'pipe' }),
    (error) => error.status === 1 && /--from needs the folder/.test(String(error.stderr)),
  );
});

test('the shipped TETHER_VERSION takes the fixes of the minor version it ships with, never a new minor', async () => {
  const range = (await readFile(new URL('../TETHER_VERSION', import.meta.url), 'utf8')).trim();
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(range, version.split('.').slice(0, 2).join('.'), 'a release bumps TETHER_VERSION with the minor');
});

test('the shipped workflow changes only on purpose: copies made with any version keep their own', async () => {
  // Copies made with 0.3.3 to 0.3.5 run an updater that also copies .github/, and GitHub refuses an Action's push that
  // changes a workflow file. Their range (0.3) holds no release with a changed workflow.
  const { createHash } = await import('node:crypto');
  const wf = await readFile(new URL('../.github/workflows/update-tether.yml', import.meta.url));
  assert.equal(createHash('sha256').update(wf).digest('hex').slice(0, 12), WORKFLOW_HASH);
});

const SHA = 'a'.repeat(40);
/** A fake GitHub API: path -> answer. */
const github = (answers) => async (path) => {
  if (!(path in answers)) throw new Error(`unexpected ${path}`);
  return answers[path];
};

test('updater: reads every page of tags, with the commit each points at', async () => {
  const page = (from, count) =>
    Array.from({ length: count }, (_, i) => ({ name: `v0.${from + i}.0`, commit: { sha: SHA } }));
  const get = github({
    '/repos/o/r/tags?per_page=100&page=1': page(0, 100),
    '/repos/o/r/tags?per_page=100&page=2': page(100, 3),
    '/repos/o/r/tags?per_page=100&page=3': [],
  });
  const tags = await listTags(get, 'o/r');
  assert.equal(tags.length, 103);
  assert.equal(
    pickVersion(
      tags.map((t) => t.name),
      'latest',
    ),
    '0.102.0',
    'the newest tag is past the first page',
  );
});

test('updater: installs a tag only when its commit is on the default branch', async () => {
  const tags = [{ name: 'v0.6.8', sha: SHA }];
  const answers = (status) =>
    github({ '/repos/o/r': { default_branch: 'main' }, [`/repos/o/r/compare/${SHA}...main`]: { status } });
  assert.equal(await releaseCommit(answers('ahead'), 'o/r', tags, '0.6.8'), SHA);
  assert.equal(await releaseCommit(answers('identical'), 'o/r', tags, '0.6.8'), SHA);
  await assert.rejects(releaseCommit(answers('diverged'), 'o/r', tags, '0.6.8'), /not on o\/r's main branch/);
  await assert.rejects(releaseCommit(answers('behind'), 'o/r', tags, '0.6.8'), /not installed/);
  await assert.rejects(releaseCommit(answers('ahead'), 'o/r', tags, '0.6.9'), /no tag/);
});
