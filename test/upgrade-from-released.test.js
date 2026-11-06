// The route every deployed copy takes to the next release: the updater it already has, from a released version,
// installs this tree, and then its own workflow (the one it was made with) tests the result and imports src/entry.js.
// It lives outside server/ because it reads the releases from this repository's git history, which a deployed copy
// doesn't have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { KEPT, MANAGED } from '../server/scripts/update-tether.ts';
import { SHIPPED_REVISION, workflowRevisionAt } from '../server/scripts/workflow-check.ts';
import { numberAt, stringAt } from '../server/test/mocks.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/**
 * One release for each updater a deployed copy can have:
 * - v0.6.7: 0.6.0 to 0.6.7 ship the same one, which downloads a release from codeload by its tag;
 * - v0.6.8: downloads it from codeload by commit, after checking the commit is on the default branch;
 * - v0.7.0: installs only the release's signed asset, after `gh attestation verify` has checked it against GitHub.
 *
 * The 0.6 updaters take their real route, against a local stand-in for GitHub. 0.7.0's would have `gh` check the
 * asset's attestation with GitHub itself, which nothing local can sign, so it installs the release with `--from`.
 *
 * @type {{ tag: string, route: 'github' | 'from' }[]}
 */
const OLD_UPDATERS = [
  { tag: 'v0.6.7', route: 'github' },
  { tag: 'v0.6.8', route: 'github' },
  { tag: 'v0.7.0', route: 'from' },
];
const [major, minor, patch] = stringAt(JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')), 'version')
  .split('.')
  .map(Number);
/** The next patch release, as the release script would write it: newer than every updater above. */
const RELEASE_VERSION = `${String(major)}.${String(minor)}.${String(Number(patch) + 1)}`;
const UPGRADE_TIMEOUT_MS = 180_000;
const UPSTREAM = 'test-owner/tether';
const RELEASE_SHA = 'c0ffee'.repeat(6).padEnd(40, '0');
const OFFLINE_GITHUB = pathToFileURL(join(ROOT, 'test', 'offline-github.js')).href;
const OUTDATED = /^::warning title=Tether workflow file outdated::/m;

const run = promisify(execFile);

/**
 * @param {string} tag
 * @returns Whether the tag is in this checkout: a shallow clone without tags has none.
 */
function hasTag(tag) {
  try {
    execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', `${tag}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    // Not a git checkout, or the tag isn't fetched.
    return false;
  }
}

/**
 * The files of this tree's `server/` that a release ships, relative to it: what git tracks or would track, so neither
 * ignored local files (node_modules/, .dev.vars, .wrangler/) nor tracked files deleted from the working tree.
 */
function serverFiles() {
  const listed = execFileSync(
    'git',
    ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'server'],
    { encoding: 'utf8' },
  );
  return listed
    .split('\0')
    .filter((name) => name && existsSync(join(ROOT, name)))
    .map((name) => name.slice('server/'.length));
}

test('every top-level entry of server/ is one the updater replaces or keeps, or the workflow folder', () => {
  const known = [...MANAGED, ...KEPT, '.github'];
  const entries = new Set(serverFiles().map((name) => name.split('/')[0] ?? name));
  assert.deepEqual(
    [...entries].filter((entry) => !known.includes(entry)),
    [],
    "an entry the updaters don't list is never installed in a copy",
  );
});

/**
 * Writes the tag's `server/` folder into `target`, through one `git cat-file --batch`, without touching this
 * checkout's index or worktree.
 *
 * @param {string} tag
 * @param {string} target
 */
async function extractServer(tag, target) {
  const names = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', tag, 'server/'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const batch = execFileSync('git', ['-C', ROOT, 'cat-file', '--batch'], {
    input: names.map((name) => `${tag}:${name}\n`).join(''),
    maxBuffer: 64 * 1024 * 1024,
  });
  let offset = 0;
  for (const name of names) {
    const headerEnd = batch.indexOf(0x0a, offset);
    const [, type, size] = batch.subarray(offset, headerEnd).toString('utf8').split(' ');
    assert.equal(type, 'blob', name);
    const start = headerEnd + 1;
    const end = start + Number(size);
    const path = join(target, name.slice('server/'.length));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, batch.subarray(start, end));
    // Each object is followed by a newline.
    offset = end + 1;
  }
}

/**
 * This tree's `server/` as the release would ship it, at {@link RELEASE_VERSION}.
 *
 * @param {string} target
 */
async function releaseFolder(target) {
  for (const name of serverFiles()) {
    await mkdir(dirname(join(target, name)), { recursive: true });
    await cp(join(ROOT, 'server', name), join(target, name));
  }
  const pkgPath = join(target, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  await writeFile(pkgPath, `${JSON.stringify({ ...pkg, version: RELEASE_VERSION }, null, 2)}\n`);
  const versionPath = join(target, 'src', 'version.ts');
  const source = await readFile(versionPath, 'utf8');
  await writeFile(
    versionPath,
    source.replace(/export const VERSION = '[^']*';/, `export const VERSION = '${RELEASE_VERSION}';`),
  );
}

/**
 * Runs Node in the copy as its workflow does, in a repository of its own. `NODE_TEST_CONTEXT` is dropped, or the
 * copy's `node --test` would report to this test run instead of running on its own, and so is the job summary of a
 * CI run of this test, unless `summary` names a file for it.
 *
 * @param {string} copy
 * @param {string[]} args
 * @param {{ summary?: string, env?: Record<string, string> }} [options]
 */
function node(copy, args, { summary, env: extra = {} } = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, GITHUB_REPOSITORY: 'shop-owner/tether-sync', ...extra };
  delete env['NODE_TEST_CONTEXT'];
  delete env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined) env['GITHUB_STEP_SUMMARY'] = summary;
  // Node before 22.18 strips types only with the flag; the copy's workflow runs a Node 22 that does it by default.
  return run(process.execPath, ['--experimental-strip-types', '--no-warnings', ...args], {
    cwd: copy,
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * A local stand-in for GitHub as the 0.6 updaters call it: the tags, the default branch, how a tag's commit compares
 * with it, and the release's tarball by tag (0.6.0 to 0.6.7) or by commit (0.6.8).
 *
 * @param {Buffer} tarball
 */
async function fakeGitHub(tarball) {
  /** @type {string[]} */
  const requests = [];
  const repo = `/api/repos/${UPSTREAM}`;
  /** @type {Record<string, unknown>} */
  const answers = {
    [repo]: { default_branch: 'main' },
    [`${repo}/compare/${RELEASE_SHA}...main`]: { status: 'ahead' },
  };
  const downloads = [
    `/codeload/${UPSTREAM}/tar.gz/refs/tags/v${RELEASE_VERSION}`,
    `/codeload/${UPSTREAM}/tar.gz/${RELEASE_SHA}`,
  ];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requests.push(url.pathname);
    if (downloads.includes(url.pathname)) {
      response.writeHead(200, { 'content-type': 'application/x-gzip' }).end(tarball);
      return;
    }
    // 0.6.7 reads one page of tags, without a page number.
    const firstPage = (url.searchParams.get('page') ?? '1') === '1';
    const tags = firstPage ? [{ name: `v${RELEASE_VERSION}`, commit: { sha: RELEASE_SHA } }] : [];
    const answer = url.pathname === `${repo}/tags` ? tags : answers[url.pathname];
    if (answer === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const close = () => new Promise((resolve) => server.close(() => resolve(undefined)));
  return { url: `http://127.0.0.1:${String(address.port)}`, requests, close };
}

/**
 * `PATH` for a 0.6 updater. On Windows, Windows' own tar goes first: the GNU tar that Git for Windows puts on the
 * `PATH` reads the `C:` of the absolute paths those updaters pass it as a remote host. Deployed copies run on Linux.
 *
 * @returns {Record<string, string>}
 */
function tarPath() {
  const name = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const path = process.env[name] ?? '';
  if (process.platform !== 'win32') return { [name]: path };
  const system = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32');
  return { [name]: `${system}${delimiter}${path}` };
}

/**
 * Runs the copy's updater the way its workflow does, with GitHub answered by {@link fakeGitHub}: it lists the tags,
 * downloads the tarball codeload would serve for the release (a top folder holding the repository, `server/` in it),
 * and unpacks it.
 *
 * @param {string} copy
 * @param {string} release This tree's `server/`, as {@link releaseFolder} wrote it.
 * @param {string} work An empty folder for the tarball.
 */
async function updateThroughGitHub(copy, release, work) {
  const top = `tether-${RELEASE_VERSION}`;
  await cp(release, join(work, 'archive', top, 'server'), { recursive: true });
  // Relative paths: GNU tar reads the `C:` of a Windows path as a remote host.
  execFileSync('tar', ['-czf', 'release.tgz', '-C', 'archive', top], { cwd: work });
  const github = await fakeGitHub(await readFile(join(work, 'release.tgz')));
  try {
    const env = { ...tarPath(), TETHER_TEST_GITHUB: github.url, TETHER_UPSTREAM: UPSTREAM };
    const update = await node(copy, ['--import', OFFLINE_GITHUB, 'scripts/update-tether.mjs'], { env });
    assert.ok(
      github.requests.some((path) => path.startsWith(`/codeload/${UPSTREAM}/tar.gz/`)),
      'the release was downloaded',
    );
    return update;
  } finally {
    await github.close();
  }
}

for (const { tag, route } of OLD_UPDATERS) {
  test(
    `a copy made from ${tag} installs this tree with its own updater, and its workflow's steps pass; a later failed update shows on the run`,
    {
      timeout: UPGRADE_TIMEOUT_MS,
    },
    async (t) => {
      if (!hasTag(tag)) {
        // CI must fetch the tag (ci.yml), so the test can't go quiet there.
        if (process.env['CI']) assert.fail(`${tag} is not in this checkout: fetch the tags`);
        t.skip(`${tag} is not in this checkout (git fetch --tags runs it)`);
        return;
      }
      const work = await mkdtemp(join(tmpdir(), 'tether-upgrade-'));
      try {
        const copy = join(work, 'copy');
        const release = join(work, 'release');
        await extractServer(tag, copy);
        await releaseFolder(release);
        const ownConfig = await readFile(join(copy, 'tether-sync.config.js'), 'utf8');
        const revision = await workflowRevisionAt(copy);
        assert.ok(revision !== null, `${tag} ships the update workflow`);
        const outdated = revision < SHIPPED_REVISION;

        const update =
          route === 'github'
            ? await updateThroughGitHub(copy, release, join(work, 'download'))
            : await node(copy, ['scripts/update-tether.mjs', '--from', release]);
        assert.match(update.stdout, new RegExp(`^updated=${RELEASE_VERSION.replaceAll('.', '\\.')}$`, 'm'));
        assert.equal(JSON.parse(await readFile(join(copy, 'package.json'), 'utf8')).version, RELEASE_VERSION);
        assert.equal(
          await readFile(join(copy, 'tether-sync.config.js'), 'utf8'),
          ownConfig,
          'the copy keeps its config',
        );
        for (const name of await readdir(release)) {
          assert.ok(existsSync(join(copy, name)), `${tag}'s updater installs ${name}`);
        }
        if (!outdated) assert.doesNotMatch(update.stdout, OUTDATED, 'the workflow the copy has is current');

        // The test steps every revision of the workflow runs. A step is judged by its exit code, which node() checks;
        // the reporter is pinned only so the count below reads the same on every Node (24 defaults to the spec
        // reporter, which has no TAP summary), and so a run of no tests can't pass as success.
        const tests = await node(copy, ['--test', '--test-reporter=tap', 'test/*.test.js']).catch((error) => {
          assert.fail(`the copy's tests failed:\n${String(error.stdout)}${String(error.stderr)}`);
        });
        assert.match(tests.stdout, /^# tests [1-9]\d*$/m, 'the copy ran its tests');
        assert.match(tests.stdout, /^# fail 0$/m);
        const entry = await node(copy, ['-e', "import('./src/entry.js').then(() => console.log('entry ok'))"]);
        assert.equal(entry.stdout.trim(), 'entry ok');

        const cli = await node(copy, ['bin/tether-sync.js']);
        assert.match(cli.stdout, /^tether-sync </);
        const again = await node(copy, ['scripts/update-tether.mjs', '--from', release]);
        assert.match(again.stdout, /^up to date$/m);
        assert.match(again.stdout, /^updated=$/m);
        if (outdated) {
          assert.match(again.stdout, new RegExp(`${OUTDATED.source}.* is revision ${String(revision)},`, 'm'));
        } else assert.doesNotMatch(again.stdout, OUTDATED);

        // A failing run. Revision 1 of the workflow pipes the updater through `tee` without pipefail, so its step
        // passes whatever the exit code, and only the annotation and the summary show the failure; later revisions
        // fail the step on the exit code.
        const refused = join(work, 'refused');
        await cp(release, refused, { recursive: true });
        const refusedPkgPath = join(refused, 'package.json');
        const refusedPkg = JSON.parse(await readFile(refusedPkgPath, 'utf8'));
        delete refusedPkg.version;
        await writeFile(refusedPkgPath, JSON.stringify(refusedPkg, null, 2));
        const summary = join(work, 'summary.md');
        const failed = await node(copy, ['scripts/update-tether.mjs', '--from', refused], { summary }).then(
          () => assert.fail('the update of a release without a version passed'),
          (/** @type {unknown} */ error) => error,
        );
        assert.equal(numberAt(failed, 'code'), 1);
        const stdout = stringAt(failed, 'stdout');
        assert.match(stdout, /^::error title=Tether update failed::.*package\.json has no version$/m);
        if (outdated) {
          assert.match(stdout, new RegExp(`${OUTDATED.source}.* is revision ${String(revision)},`, 'm'));
          assert.match(await readFile(summary, 'utf8'), /^### Update the workflow file once$/m);
        } else {
          assert.doesNotMatch(stdout, OUTDATED);
          assert.ok(!existsSync(summary), 'nothing to add to the summary');
        }
        assert.doesNotMatch(stdout, /^updated=/m, 'no workflow installs anything');
        assert.equal(JSON.parse(await readFile(join(copy, 'package.json'), 'utf8')).version, RELEASE_VERSION);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
  );
}
