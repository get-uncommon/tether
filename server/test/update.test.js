// The updater a deployed copy runs (scripts/update-tether.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listTags, pickVersion, releaseCommit } from '../scripts/update-tether.ts';
import {
  FIRST_SIGNED_RELEASE,
  fetchSignedRelease,
  releaseAssetName,
  releaseAssetUrl,
  verifyAttestation,
} from '../scripts/release-asset.ts';
import {
  reportWorkflow,
  SHIPPED_REVISION,
  workflowRevision,
  workflowRevisionAt,
  workflowState,
  WORKFLOW_PATH,
} from '../scripts/workflow-check.ts';

/** The type-stripping flag this run was started with (Node before 22.18 needs it), passed on to the updater. */
const NODE_FLAGS = process.execArgv.filter((flag) => flag === '--experimental-strip-types');

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

  const out = execFileSync(
    process.execPath,
    [...NODE_FLAGS, join(copy, 'scripts', 'update-tether.mjs'), '--from', release],
    {
      encoding: 'utf8',
    },
  );
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

  const again = execFileSync(
    process.execPath,
    [...NODE_FLAGS, join(copy, 'scripts', 'update-tether.mjs'), '--from', release],
    {
      encoding: 'utf8',
    },
  );
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
  return lines[lines.length - 1].split('=')[1];
}

test('a failed update exits non-zero, and --from without a folder is refused', () => {
  const script = fileURLToPath(new URL('../scripts/update-tether.ts', import.meta.url));
  assert.throws(
    () => execFileSync(process.execPath, [...NODE_FLAGS, script, '--from'], { encoding: 'utf8', stdio: 'pipe' }),
    /** @param {Error & import('node:child_process').SpawnSyncReturns<string>} error What execFileSync throws. */
    (error) => error.status === 1 && /--from needs the folder/.test(String(error.stderr)),
  );
});

test('the shipped TETHER_VERSION takes the fixes of the minor version it ships with, never a new minor', async () => {
  const range = (await readFile(new URL('../TETHER_VERSION', import.meta.url), 'utf8')).trim();
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(range, version.split('.').slice(0, 2).join('.'), 'a release bumps TETHER_VERSION with the minor');
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

const RELEASE = { upstream: 'o/r', version: '0.7.1', sha: SHA };

/** A fake command runner: records each call and answers with `result`. */
function fakeGh(result) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return result;
  };
  return { run, calls };
}

test('release asset: found by its name on the GitHub Release of the tag', async () => {
  const get = github({
    '/repos/o/r/releases/tags/v0.7.1': {
      assets: [
        { name: 'tether.min.js', browser_download_url: 'https://x.test/tether.min.js' },
        { name: releaseAssetName('0.7.1'), browser_download_url: 'https://x.test/server.tar.gz' },
      ],
    },
  });
  assert.equal(await releaseAssetUrl(get, RELEASE), 'https://x.test/server.tar.gz');
});

test('release asset: a release without one (before 0.7.0) is refused with a message saying why', async () => {
  const noAsset = github({ '/repos/o/r/releases/tags/v0.6.8': { assets: [] } });
  const old = { ...RELEASE, version: '0.6.8' };
  await assert.rejects(releaseAssetUrl(noAsset, old), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /v0\.6\.8 has no signed tether-server-0\.6\.8\.tar\.gz/);
    assert.ok(error.message.includes(`before ${FIRST_SIGNED_RELEASE} have none`));
    return true;
  });
  await assert.rejects(releaseAssetUrl(github({}), old), /has no signed .*unexpected \/repos\/o\/r\/releases/);
});

test('attestation: gh verifies the file against the upstream release workflow and the tag commit', () => {
  const gh = fakeGh({ kind: 'exited', status: 0, output: 'Verification succeeded!' });
  assert.deepEqual(verifyAttestation(gh.run, '/tmp/a.tgz', RELEASE, 'require'), { kind: 'verified' });
  assert.deepEqual(gh.calls, [
    [
      'gh',
      'attestation',
      'verify',
      '/tmp/a.tgz',
      '--repo',
      'o/r',
      '--signer-workflow',
      'o/r/.github/workflows/release.yml',
      '--source-ref',
      'refs/tags/v0.7.1',
      '--source-digest',
      SHA,
    ],
  ]);
});

test('attestation: a failed check is refused, even with --allow-unverified', () => {
  const gh = fakeGh({ kind: 'exited', status: 1, output: 'no matching attestations' });
  for (const policy of /** @type {const} */ (['require', 'allow-unverified'])) {
    assert.throws(
      () => verifyAttestation(gh.run, 'a.tgz', RELEASE, policy),
      /failed its attestation check: not installed\nno matching attestations/,
    );
  }
});

test('attestation: without gh it refuses unless --allow-unverified is given', () => {
  const gh = fakeGh({ kind: 'missing' });
  assert.throws(
    () => verifyAttestation(gh.run, 'a.tgz', RELEASE, 'require'),
    /gh\) is not installed.*--allow-unverified/s,
  );
  assert.deepEqual(verifyAttestation(gh.run, 'a.tgz', RELEASE, 'allow-unverified'), { kind: 'unverified' });
});

/** A release archive laid out like the release workflow's: `tether-server-<version>/server/…`. */
async function releaseArchive(base) {
  const build = join(base, 'build');
  await mkdir(join(build, 'tether-server-0.7.1', 'server'), { recursive: true });
  await writeFile(join(build, 'tether-server-0.7.1', 'server', 'package.json'), JSON.stringify({ version: '0.7.1' }));
  const archive = join(base, 'built.tgz');
  // Relative paths: Windows' tar reads `C:` in an absolute path as a remote host.
  execFileSync('tar', ['-czf', 'built.tgz', '-C', 'build', 'tether-server-0.7.1'], { cwd: base });
  return archive;
}

test('a signed release is unpacked only after its attestation verifies', async () => {
  const base = await mkdtemp(join(tmpdir(), 'tether-signed-'));
  const archive = await releaseArchive(base);
  const get = github({
    '/repos/o/r/releases/tags/v0.7.1': {
      assets: [{ name: releaseAssetName('0.7.1'), browser_download_url: 'https://x.test/a' }],
    },
  });
  const download = async (url, dir) => {
    assert.equal(url, 'https://x.test/a');
    const file = join(dir, 'release.tgz');
    await cp(archive, file);
    return file;
  };
  const refused = join(base, 'refused');
  await mkdir(refused);
  const failing = { get, download, run: fakeGh({ kind: 'exited', status: 1, output: 'bad' }).run };
  await assert.rejects(fetchSignedRelease(failing, RELEASE, refused, 'require'), /attestation check/);
  assert.ok(!existsSync(join(refused, 'server')), 'nothing unpacked');

  const accepted = join(base, 'accepted');
  await mkdir(accepted);
  const passing = { get, download, run: fakeGh({ kind: 'exited', status: 0, output: '' }).run };
  const server = await fetchSignedRelease(passing, RELEASE, accepted, 'require');
  assert.equal(JSON.parse(await readFile(join(server, 'package.json'), 'utf8')).version, '0.7.1');
});

test('workflow revision: the line in the file, 1 without it', () => {
  assert.equal(workflowRevision('name: Update Tether\n'), 1);
  assert.equal(workflowRevision('# x\r\n# Tether workflow revision: 3\r\nname: y\r\n'), 3);
});

/** A folder holding a workflow file with `text`, or no workflow when `text` is null. */
async function withWorkflow(base, name, text) {
  const dir = join(base, name);
  await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  if (text !== null) await writeFile(join(dir, WORKFLOW_PATH), text);
  return dir;
}

test('workflow check: outdated only when the release ships a higher revision', async () => {
  const base = await mkdtemp(join(tmpdir(), 'tether-workflow-'));
  const old = await withWorkflow(base, 'old', "on:\n  schedule:\n    - cron: '23 5 * * *'\n");
  const same = await withWorkflow(base, 'same', 'name: Update Tether\n');
  const newer = await withWorkflow(base, 'newer', '# Tether workflow revision: 2\n');
  const none = await withWorkflow(base, 'none', null);
  const against = async (release) => workflowState(old, await workflowRevisionAt(release));
  assert.deepEqual(await against(newer), { kind: 'outdated', copy: 1, release: 2 });
  assert.deepEqual(await against(same), { kind: 'current' }, 'an edited cron is not outdated');
  assert.deepEqual(await against(none), { kind: 'not-compared' }, 'a release folder without the workflow');
  assert.deepEqual(await workflowState(newer, 1), { kind: 'current' });
  assert.deepEqual(await workflowState(none, 2), { kind: 'not-compared' }, 'a copy without Actions');
});

test('workflow check: an outdated workflow gets a GitHub warning and the manual step in the job summary', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'tether-summary-'));
  const summary = join(base, 'summary.md');
  const previous = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = summary;
  t.after(() => {
    if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = previous;
  });
  const log = t.mock.method(console, 'log', () => {});
  await reportWorkflow({ kind: 'current' }, '0.7.1', 'https://x.test');
  assert.equal(log.mock.callCount(), 0);
  assert.ok(!existsSync(summary));
  await reportWorkflow({ kind: 'outdated', copy: 1, release: 2 }, '0.7.1', 'https://x.test/update-tether.yml');
  const warning = String(log.mock.calls[0].arguments[0]);
  assert.match(warning, /^::warning title=[^:]+::/);
  assert.match(warning, /revision 1, Tether 0\.7\.1 ships revision 2/);
  const step =
    'Copy the Tether 0.7.1 workflow file (https://x.test/update-tether.yml) over .github/workflows/update-tether.yml ' +
    'in this repository and commit it, once, by hand';
  assert.ok(warning.includes(step), 'the warning gives the one-time manual step');
  const summaryText = await readFile(summary, 'utf8');
  assert.ok(summaryText.startsWith(`### Update the workflow file once\n\n${step}`), 'and so does the job summary');
});

test('an update run by its workflow warns when the copy needs the release workflow, and keeps the output contract', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const base = await mkdtemp(join(tmpdir(), 'tether-outdated-'));
  const copy = join(base, 'copy');
  const release = join(base, 'release');
  await cp(root, release, { recursive: true, filter: (p) => !p.includes('node_modules') });
  await cp(release, copy, { recursive: true });
  await writeFile(join(copy, 'package.json'), JSON.stringify({ name: '@occluze/tether-sync', version: '0.3.1' }));
  const copyWorkflow = await readFile(join(copy, WORKFLOW_PATH), 'utf8');
  await writeFile(join(release, WORKFLOW_PATH), `# Tether workflow revision: 99\n${copyWorkflow}`);
  const summary = join(base, 'summary.md');

  const out = execFileSync(
    process.execPath,
    [...NODE_FLAGS, join(copy, 'scripts', 'update-tether.mjs'), '--from', release],
    {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    },
  );
  assert.match(out, /^::warning title=Tether workflow file outdated::/m);
  assert.match(await readFile(summary, 'utf8'), /Update the workflow file once/);
  assert.equal(await readFile(join(copy, WORKFLOW_PATH), 'utf8'), copyWorkflow, 'the workflow file is never touched');
  const version = JSON.parse(await readFile(join(release, 'package.json'), 'utf8')).version;
  assert.equal(workflowVersion(out), version);
});

test('an update run with nothing to install still warns while the copy has an older workflow', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const base = await mkdtemp(join(tmpdir(), 'tether-current-'));
  const copy = join(base, 'copy');
  await cp(root, copy, { recursive: true, filter: (p) => !p.includes('node_modules') });
  await mkdir(join(copy, '.github', 'workflows'), { recursive: true });
  await writeFile(join(copy, WORKFLOW_PATH), 'name: Update Tether\n');
  const version = JSON.parse(await readFile(join(copy, 'package.json'), 'utf8')).version;

  const out = execFileSync(
    process.execPath,
    [...NODE_FLAGS, join(copy, 'scripts', 'update-tether.mjs'), '--from', copy],
    {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: join(base, 'summary.md') },
    },
  );
  assert.match(out, /up to date/);
  assert.ok(
    out.includes(`revision 1, Tether ${version} ships revision ${String(SHIPPED_REVISION)}`),
    'a copy brought to this release by an older updater is told too',
  );
  assert.equal(workflowVersion(out), '');
});
