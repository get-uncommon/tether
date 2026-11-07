// The route every deployed copy takes to the next release: its own workflow (the one it was made with) runs the
// updater it already has, from a released version, which installs this tree; the workflow then records the change,
// tests it, imports src/entry.js, and commits and pushes what it recorded. It lives outside server/ because it reads
// the releases from this repository's git history, which a deployed copy doesn't have.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { releaseAssetName } from '../server/scripts/release-asset.ts';
import { compareVersions, parseVersion, versionsInRange } from '../server/src/release-range.ts';
import { KEPT, MANAGED } from '../server/scripts/update-tether.ts';
import { SHIPPED_REVISION, WORKFLOW_PATH, workflowRevisionAt } from '../server/scripts/workflow-check.ts';
import { installGhStub } from './gh-stub.js';
import { asRecord, fieldOf, listenForFetch, numberAt, parseJson, stringAt } from '../server/test/mocks.js';
import {
  COPY_REPOSITORY,
  NODE_OPTIONS,
  runWorkflow,
  TEST_STEP,
  UPDATE_STEP_ID,
  workflowPath,
} from './update-workflow-runner.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** @param {string} folder A copy of server/. */
const versionIn = async (folder) => fieldOf(parseJson(await readFile(join(folder, 'package.json'), 'utf8')), 'version');
/**
 * One release for each updater a deployed copy can have, and the newest release:
 * - v0.6.7: 0.3.6 to 0.6.7 ship the same one, which downloads a release from codeload by its tag;
 * - v0.6.8: downloads it from codeload by commit, after checking the commit is on the default branch;
 * - v0.7.0: installs only the release's signed asset, after `gh attestation verify` has checked it against GitHub;
 * - v0.7.1: skips a tag whose Release doesn't carry the asset yet, for the newest one that does;
 * - v0.7.2: the v0.7.1 updater, in 0.7.2's copy;
 * - v0.8.0: also removes the managed entries a release doesn't ship, refuses a release without the files the
 *   workflow runs after an update, and writes the minor of the release it installed, not its own, into a copy
 *   without a `TETHER_VERSION`;
 * - v0.9.1: gives up on a GitHub request or download that stalls, after a time limit, with the update's error.
 *
 * A test below fails when a release tag's updater or workflow is none of these.
 *
 * Each takes its real route, against a local stand-in for GitHub: `codeload` downloads the tarball codeload serves,
 * `asset` the Release's asset, which a stand-in for `gh` passes (test/gh-stub.js), since nothing local can sign it.
 *
 * @type {{ tag: string, route: 'codeload' | 'asset' }[]}
 */
const OLD_UPDATERS = [
  { tag: 'v0.6.7', route: 'codeload' },
  { tag: 'v0.6.8', route: 'codeload' },
  { tag: 'v0.7.0', route: 'asset' },
  { tag: 'v0.7.1', route: 'asset' },
  { tag: 'v0.7.2', route: 'asset' },
  { tag: 'v0.8.0', route: 'asset' },
  { tag: 'v0.9.1', route: 'asset' },
];
/**
 * The first release whose updater can update a copy: the ones before it replace `.github/`, which GitHub refuses.
 *
 * @type {import('../server/src/release-range.ts').Version}
 */
const FIRST_WORKING_UPDATER = [0, 3, 6];
const treeVersion = stringAt(JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')), 'version');
/**
 * The next patch release after this tree's version, as the release script would write it, or after the newest
 * release above, for a branch made before that release: newer than every updater above.
 */
const [major, minor, patch] = [treeVersion, ...OLD_UPDATERS.map(({ tag }) => tag.slice(1))]
  .map((version) => parseVersion(version) ?? assert.fail(`${version} is not X.Y.Z`))
  .reduce((newest, version) => (compareVersions(version, newest) > 0 ? version : newest));
const RELEASE_VERSION = `${String(major)}.${String(minor)}.${String(patch + 1)}`;
const UPGRADE_TIMEOUT_MS = 180_000;
const UPSTREAM = 'test-owner/tether';
const RELEASE_SHA = 'c0ffee'.repeat(6).padEnd(40, '0');
const OFFLINE_GITHUB = pathToFileURL(join(ROOT, 'test', 'offline-github.js')).href;
const ASSET = releaseAssetName(RELEASE_VERSION);
/** Where the Release's asset is on github.com. */
const ASSET_PATH = `${UPSTREAM}/releases/download/v${RELEASE_VERSION}/${ASSET}`;
const OUTDATED = /^::warning title=Tether workflow file outdated::/m;

const run = promisify(execFile);
// execFileSync blocks the event loop, so no test timeout can end a git or tar that hangs: each has its own.
const SYNC_CHILD_TIMEOUT_MS = 60_000;

/**
 * @param {string[]} args
 * @returns Git's answer in this checkout, trimmed.
 */
const gitHere = (args) =>
  execFileSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: SYNC_CHILD_TIMEOUT_MS,
  }).trim();

/**
 * @param {string} tag
 * @returns Whether the tag is in this checkout: a shallow clone without tags has none.
 */
function hasTag(tag) {
  try {
    execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', `${tag}^{commit}`], {
      stdio: 'ignore',
      timeout: SYNC_CHILD_TIMEOUT_MS,
    });
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
    { encoding: 'utf8', timeout: SYNC_CHILD_TIMEOUT_MS },
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

/** A script's relative imports: `import … from './x.ts'`, `export … from '../y.ts'`, `import './z.ts'`. */
const RELATIVE_IMPORT = /\b(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g;
/** @type {Map<string, string[]>} The relative imports of each script blob read. */
const importsOfBlob = new Map();

/**
 * What decides how a copy made from `tag` updates: the update workflow it keeps, the updater script that workflow
 * runs, and every file of the copy that script imports, directly or not.
 *
 * @param {string} tag
 * @returns {string} Each of those files' path in `server/` and blob, one per line.
 */
function updaterOf(tag) {
  /** @type {Map<string, string>} */
  const blobs = new Map();
  for (const line of gitHere(['ls-tree', '-r', tag, '--', 'server/']).split('\n')) {
    const [info = '', path = ''] = line.split('\t');
    blobs.set(path.slice('server/'.length), info.split(' ')[2] ?? '');
  }
  const files = new Set([WORKFLOW_PATH]);
  const pending = ['scripts/update-tether.mjs'];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (files.has(path)) continue;
    files.add(path);
    const blob = blobs.get(path);
    assert.ok(blob, `${tag}: server/${path} is imported, but the tag doesn't have it`);
    const imports =
      importsOfBlob.get(blob) ??
      [...gitHere(['cat-file', 'blob', blob]).matchAll(RELATIVE_IMPORT)].map(([, specifier = '']) => specifier);
    importsOfBlob.set(blob, imports);
    pending.push(...imports.map((specifier) => posix.join(posix.dirname(path), specifier)));
  }
  return [...files]
    .sort()
    .map((path) => `${path} ${blobs.get(path) ?? 'none'}`)
    .join('\n');
}

/**
 * The release tags in this checkout that a copy can update from, but for one on HEAD: that is the release being made
 * (`npm run release` tags it before the gate its push runs, and release.yml runs on it), and its tree is the one
 * these tests install.
 *
 * @returns {string[]} None in a checkout without tags, or outside a git checkout.
 */
function releasedTags() {
  try {
    const atHead = new Set(gitHere(['tag', '--points-at', 'HEAD']).split('\n'));
    return gitHere(['tag', '--list', 'v*'])
      .split('\n')
      .filter((tag) => {
        const version = parseVersion(tag.slice(1));
        return version !== null && compareVersions(version, FIRST_WORKING_UPDATER) >= 0 && !atHead.has(tag);
      });
  } catch {
    // Not a git checkout.
    return [];
  }
}

test('every release a copy can be made from has its updater and workflow tested, through OLD_UPDATERS', (t) => {
  const tags = releasedTags();
  if (!tags.length) {
    if (process.env['CI']) assert.fail('no release tags in this checkout: fetch the tags');
    t.skip('no release tags in this checkout (git fetch --tags runs it)');
    return;
  }
  const tested = new Set(OLD_UPDATERS.filter(({ tag }) => hasTag(tag)).map(({ tag }) => updaterOf(tag)));
  assert.deepEqual(
    tags.filter((tag) => !tested.has(updaterOf(tag))),
    [],
    'add each to OLD_UPDATERS, with the route its updater takes',
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
  const names = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', tag, 'server/'], {
    encoding: 'utf8',
    timeout: SYNC_CHILD_TIMEOUT_MS,
  })
    .split('\n')
    .filter(Boolean);
  const batch = execFileSync('git', ['-C', ROOT, 'cat-file', '--batch'], {
    input: names.map((name) => `${tag}:${name}\n`).join(''),
    maxBuffer: 64 * 1024 * 1024,
    timeout: SYNC_CHILD_TIMEOUT_MS,
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
  const pkg = asRecord(parseJson(await readFile(pkgPath, 'utf8')), 'package.json');
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
  const env = { ...process.env, GITHUB_REPOSITORY: COPY_REPOSITORY, ...extra };
  delete env['NODE_TEST_CONTEXT'];
  delete env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined) env['GITHUB_STEP_SUMMARY'] = summary;
  // Node before 22.18 strips types only with the flag; the copy's workflow runs a Node 22 that does it by default.
  return run(process.execPath, ['--experimental-strip-types', '--no-warnings', ...args], {
    cwd: copy,
    env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
}

/**
 * A local stand-in for GitHub as the released updaters call it: the tags, the default branch, how a tag's commit
 * compares with it, the GitHub Release, and the release's tarball by tag (0.6.0 to 0.6.7), by commit (0.6.8) or as
 * the Release's asset (0.7.0 on).
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
    [`${repo}/releases/tags/v${RELEASE_VERSION}`]: {
      assets: [{ name: ASSET, browser_download_url: `https://github.com/${ASSET_PATH}` }],
    },
  };
  const downloads = [
    `/codeload/${UPSTREAM}/tar.gz/refs/tags/v${RELEASE_VERSION}`,
    `/codeload/${UPSTREAM}/tar.gz/${RELEASE_SHA}`,
    `/web/${ASSET_PATH}`,
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
  // The updaters reach it with fetch.
  const port = await listenForFetch(server);
  const close = () => {
    server.closeAllConnections();
    return new Promise((resolve) =>
      server.close(() => {
        resolve(undefined);
      }),
    );
  };
  return { url: `http://127.0.0.1:${String(port)}`, requests, close };
}

/**
 * @param {string} release This tree's `server/`, as {@link releaseFolder} wrote it.
 * @param {string} work A folder for the tarball.
 * @param {'codeload' | 'asset'} route
 * @returns {Promise<Buffer>} The release as `route` downloads it: a top folder with `server/` in it, the repository in
 *   codeload's tarball, the folder alone in the asset.
 */
async function tarball(release, work, route) {
  // The asset's layout is release.yml's `git archive --prefix="tether-server-$V/" … -- server`.
  const top = route === 'asset' ? `tether-server-${RELEASE_VERSION}` : `tether-${RELEASE_VERSION}`;
  await cp(release, join(work, 'archive', top, 'server'), { recursive: true });
  // Relative paths: GNU tar reads the `C:` of a Windows path as a remote host.
  execFileSync('tar', ['-czf', 'release.tgz', '-C', 'archive', top], { cwd: work, timeout: SYNC_CHILD_TIMEOUT_MS });
  return readFile(join(work, 'release.tgz'));
}

/**
 * What every copy's test installs or reads, built once for the file, since they all install the same release: the
 * release, the release the updater refuses for having no version, each route's tarball, and the `gh` stand-in.
 *
 * @typedef {{ release: string, refused: string, tarballs: Record<'codeload' | 'asset', Buffer>, ghBin: string,
 *   ghOptions: string[] }} Release
 */

const SHARED = mkdtempSync(join(tmpdir(), 'tether-upgrade-release-'));
after(() => rm(SHARED, { recursive: true, force: true }));
/** @type {Promise<Release> | undefined} */
let built;

/** @returns {Promise<Release>} */
async function buildRelease() {
  const release = join(SHARED, 'release');
  await releaseFolder(release);
  const refused = join(SHARED, 'refused');
  await cp(release, refused, { recursive: true });
  const refusedPkgPath = join(refused, 'package.json');
  const refusedPkg = asRecord(parseJson(await readFile(refusedPkgPath, 'utf8')), 'package.json');
  delete refusedPkg['version'];
  await writeFile(refusedPkgPath, JSON.stringify(refusedPkg, null, 2));
  const tarballs = {
    codeload: await tarball(release, join(SHARED, 'codeload'), 'codeload'),
    asset: await tarball(release, join(SHARED, 'asset'), 'asset'),
  };
  const ghBin = join(SHARED, 'bin');
  return { release, refused, tarballs, ghBin, ghOptions: await installGhStub(ghBin) };
}

/** @returns {Promise<Release>} */
function sharedRelease() {
  built ??= buildRelease();
  return built;
}

/**
 * Puts the release on {@link fakeGitHub} the way `route` downloads it.
 *
 * @param {Release} release
 * @param {string} work A folder for what the `gh` stand-in is called with.
 * @param {'codeload' | 'asset'} route
 * @returns The stand-in, the environment that sends the copy's updater to it, and a check of what the updater did.
 */
async function publishRelease({ tarballs, ghBin, ghOptions }, work, route) {
  const github = await fakeGitHub(tarballs[route]);
  await mkdir(work, { recursive: true });
  const ghLog = join(work, 'gh-arguments.txt');
  const gh =
    route === 'asset'
      ? { env: { ...workflowPath([ghBin]), TETHER_TEST_GH_LOG: ghLog }, nodeOptions: ghOptions }
      : { env: workflowPath([]), nodeOptions: [] };
  /** @type {Record<string, string>} */
  const env = {
    ...gh.env,
    TETHER_TEST_GITHUB: github.url,
    TETHER_UPSTREAM: UPSTREAM,
    NODE_OPTIONS: [...NODE_OPTIONS, `--import=${OFFLINE_GITHUB}`, ...gh.nodeOptions].join(' '),
  };
  const checkDownload = async () => {
    const download = route === 'asset' ? `/web/${ASSET_PATH}` : `/codeload/${UPSTREAM}/tar.gz/`;
    assert.ok(
      github.requests.some((requested) => requested.startsWith(download)),
      'the release was downloaded',
    );
    if (route === 'codeload') return;
    const [command, verify, file, ...flags] = (await readFile(ghLog, 'utf8')).trimEnd().split('\n');
    assert.deepEqual([command, verify], ['attestation', 'verify']);
    assert.match(file ?? '', /release\.tgz$/, 'gh checks the downloaded asset');
    assert.deepEqual(flags, [
      '--repo',
      UPSTREAM,
      '--signer-workflow',
      `${UPSTREAM}/.github/workflows/release.yml`,
      '--source-ref',
      `refs/tags/v${RELEASE_VERSION}`,
      '--source-digest',
      RELEASE_SHA,
    ]);
  };
  return { github, env, checkDownload };
}

/**
 * Checks that the workflow pushed the update to the copy's repository, holding what the update job staged: the patch
 * its record step took before the tests ran, or, in revision 1, what it staged after them.
 *
 * @param {import('./update-workflow-runner.js').WorkflowRun} workflow
 */
function checkPushed({ git, origin, copy, summary }) {
  assert.equal(git(origin, ['log', '-1', '--format=%s', 'main']), `Update Tether to v${RELEASE_VERSION}`);
  assert.equal(git(origin, ['rev-parse', 'main^{tree}']), git(copy, ['write-tree']), 'the commit is what was tested');
  assert.match(summary, new RegExp(`^### Updated to v${RELEASE_VERSION.replaceAll('.', '\\.')}$`, 'm'));
}

/**
 * A copy whose `TETHER_VERSION` range leaves out the release (a copy on `0.7` when this tree is a new minor) stays on
 * its line, as `pickVersion` and its tests in server/test/update.test.js show. To take the release, its owner writes
 * the new minor in the file, the one-time step the release notes give; the copy here does the same, so the update is
 * tested at whatever version this tree is.
 *
 * @param {string} deployed
 */
async function takeThisMinor(deployed) {
  const file = join(deployed, 'TETHER_VERSION');
  const spec = existsSync(file) ? (await readFile(file, 'utf8')).trim() : 'latest';
  if (versionsInRange([RELEASE_VERSION], spec).length > 0) return;
  await writeFile(
    file,
    `${RELEASE_VERSION.split('.').slice(0, 2).join('.')}
`,
  );
}

/**
 * Every copy installs the same release, so the release's whole server/test runs in the first copy's test step only,
 * in this tree's layout as a copy has it; each later copy's step runs one file, which still shows the step runs the
 * installed tests, judged by their exit code.
 */
let wholeSuiteRan = false;
/** Reads the copy's own files: its package.json, its .dev.vars.example and its config. */
const ONE_TEST_FILE = 'test/setup.test.js';

for (const { tag, route } of OLD_UPDATERS) {
  test(
    `a copy made from ${tag} is updated to this tree by its own workflow and updater, which commits what it tested; a later failed update shows on the run`,
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
        const deployed = join(work, 'deployed');
        await extractServer(tag, deployed);
        await takeThisMinor(deployed);
        const shared = await sharedRelease();
        const { release } = shared;
        const ownConfig = await readFile(join(deployed, 'tether-sync.config.js'), 'utf8');
        const revision = await workflowRevisionAt(deployed);
        assert.ok(revision !== null, `${tag} ships the update workflow`);
        const outdated = revision < SHIPPED_REVISION;

        const published = await publishRelease(shared, join(work, 'download'), route);
        const testFiles = wholeSuiteRan ? ONE_TEST_FILE : undefined;
        wholeSuiteRan = true;
        const workflow = await runWorkflow(deployed, join(work, 'actions'), published.env, testFiles).finally(() =>
          published.github.close(),
        );
        await published.checkDownload();
        const { copy, logs } = workflow;
        const update = logs.get(UPDATE_STEP_ID) ?? '';
        assert.match(update, new RegExp(`^updated=${RELEASE_VERSION.replaceAll('.', '\\.')}$`, 'm'));
        assert.equal(await versionIn(copy), RELEASE_VERSION);
        assert.equal(
          await readFile(join(copy, 'tether-sync.config.js'), 'utf8'),
          ownConfig,
          'the copy keeps its config',
        );
        for (const name of await readdir(release)) {
          assert.ok(existsSync(join(copy, name)), `${tag}'s updater installs ${name}`);
        }
        if (!outdated) assert.doesNotMatch(update, OUTDATED, 'the workflow the copy has is current');

        // The test step every revision runs. It is judged by its exit code, which runWorkflow checks; the count shows
        // tests ran, in the TAP reporter Node 22 uses without a terminal, or the spec reporter of Node 24.
        const tests = logs.get(TEST_STEP) ?? '';
        assert.match(tests, /^(?:# |ℹ )tests [1-9]\d*$/m, 'the copy ran its tests');
        assert.match(tests, /^(?:# |ℹ )fail 0$/m);
        assert.match(tests, /^entry ok$/m);
        checkPushed(workflow);

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
        const summary = join(work, 'summary.md');
        const failed = await node(copy, ['scripts/update-tether.mjs', '--from', shared.refused], { summary }).then(
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
        assert.equal(await versionIn(copy), RELEASE_VERSION);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
  );
}
