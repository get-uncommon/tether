// The route every copy deployed before 0.7.0 takes: its own 0.6 updater installs this tree, and then its own
// workflow (the same file in every 0.6 release) tests the result and imports src/entry.js. It lives outside server/
// because it reads the tags from this repository's git history, which a deployed copy doesn't have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { numberAt, stringAt } from '../server/test/mocks.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER = join(ROOT, 'server');
/**
 * One release for each updater a 0.6 copy can have: 0.6.0 to 0.6.7 ship the same one, which downloads a release by
 * its tag, and 0.6.8's downloads it by commit after checking the commit is on the default branch.
 */
const OLD_TAGS = ['v0.6.7', 'v0.6.8'];
/** Newer than every 0.6 release, as the release script would write it. */
const RELEASE_VERSION = '0.7.0';
const UPGRADE_TIMEOUT_MS = 180_000;

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
 * This tree's `server/` as the release would ship it: its version raised above every 0.6 release.
 *
 * @param {string} target
 */
async function releaseFolder(target) {
  await cp(SERVER, target, {
    recursive: true,
    filter: (source) => !['node_modules', '.dev.vars', '.tether-sync-state.json'].includes(basename(source)),
  });
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
 * @param {{ summary?: string }} [options]
 */
function node(copy, args, { summary } = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, GITHUB_REPOSITORY: 'shop-owner/tether-sync' };
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

for (const oldTag of OLD_TAGS) {
  test(
    `a copy made from ${oldTag} installs this tree with its own updater, and its workflow steps pass; a later failed update shows on the run`,
    {
      timeout: UPGRADE_TIMEOUT_MS,
    },
    async (t) => {
      if (!hasTag(oldTag)) {
        // CI must fetch the tag (ci.yml: fetch-tags), so the test can't go quiet there.
        if (process.env['CI']) assert.fail(`${oldTag} is not in this checkout: fetch the tags`);
        t.skip(`${oldTag} is not in this checkout (git fetch --tags runs it)`);
        return;
      }
      const work = await mkdtemp(join(tmpdir(), 'tether-upgrade-'));
      try {
        const copy = join(work, 'copy');
        const release = join(work, 'release');
        await extractServer(oldTag, copy);
        await releaseFolder(release);
        const ownConfig = await readFile(join(copy, 'tether-sync.config.js'), 'utf8');

        const update = await node(copy, ['scripts/update-tether.mjs', '--from', release]);
        assert.match(update.stdout, new RegExp(`^updated=${RELEASE_VERSION.replaceAll('.', '\\.')}$`, 'm'));
        assert.equal(JSON.parse(await readFile(join(copy, 'package.json'), 'utf8')).version, RELEASE_VERSION);
        assert.equal(
          await readFile(join(copy, 'tether-sync.config.js'), 'utf8'),
          ownConfig,
          'the copy keeps its config',
        );

        // The steps of the 0.6 workflow, which the copy keeps. The workflow judges this step by its exit code,
        // which node() checks; the reporter is pinned only so the count below reads the same on every Node (24
        // defaults to the spec reporter, which has no TAP summary), and so a run of no tests can't pass as success.
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
        assert.match(
          again.stdout,
          /^::warning title=Tether workflow file outdated::.* is revision 1,/m,
          'the old workflow is reported',
        );

        // A failing run: the 0.6 workflow pipes the updater through `tee` without pipefail, so its step passes
        // whatever the exit code, and only the annotation and the summary show the failure.
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
        assert.match(stdout, /^::warning title=Tether workflow file outdated::.* is revision 1,/m);
        assert.match(await readFile(summary, 'utf8'), /^### Update the workflow file once$/m);
        assert.doesNotMatch(stdout, /^updated=/m, 'the old workflow installs nothing');
        assert.equal(JSON.parse(await readFile(join(copy, 'package.json'), 'utf8')).version, RELEASE_VERSION);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
  );
}
