// The updater a deployed copy runs (scripts/update-tether.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listTags, pickVersion, releaseCommit } from '../scripts/update-tether.mjs';

const WORKFLOW_HASH = 'a369c8e1628b'; // change only together with a plan for existing copies

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

test('updating a copy replaces the code and keeps config, wrangler ids and TETHER_VERSION', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const base = await mkdtemp(join(tmpdir(), 'tether-update-'));
  const copy = join(base, 'copy');
  const release = join(base, 'release');
  // An "old" deployed copy: older version, customized mapping, Cloudflare's KV id.
  await mkdir(copy);
  await cp(join(root, 'scripts'), join(copy, 'scripts'), { recursive: true });
  await mkdir(join(copy, 'src'));
  await writeFile(join(copy, 'src', 'old.js'), 'old');
  await writeFile(join(copy, 'package.json'), JSON.stringify({ name: '@occluze/tether-sync', version: '0.3.1' }));
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

  const again = execFileSync('node', [join(copy, 'scripts', 'update-tether.mjs'), '--from', release], {
    encoding: 'utf8',
  });
  assert.match(again, /up to date/);
});

test('the shipped workflow stays identical, so copies made with any earlier version keep updating', async () => {
  // Copies from 0.3.3/0.3.4 copied .github/ too: a changed workflow would block their next update.
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
