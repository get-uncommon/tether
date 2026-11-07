// The release, smoke and ci workflows, read as text: which job may do what, in which order, and what reaches the GitHub Release.
// Also the workflow linters, which CI and the pre-push hook run through one script at the versions one file pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-dist');

test('the release attests the server asset the sync Worker updater installs, by the same name', async () => {
  const { releaseAssetName } = await import('../server/scripts/release-asset.ts');
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.equal(releaseAssetName('$V'), 'tether-server-$V.tar.gz');
  assert.ok(workflow.includes('-o "tether-server-$V.tar.gz" HEAD -- server'), 'the archive of the tagged server/');
  assert.match(workflow, /uses: actions\/attest-build-provenance@[0-9a-f]{40} #/, 'attested, pinned by commit');
  assert.match(workflow, /subject-path: \$\{\{ env\.SERVER_ASSET \}\}/);
  assert.match(workflow, /--latest="\$LATEST" "\$\{assets\[@\]\}" "\$SERVER_ASSET"/, 'uploaded to the GitHub Release');
});

/**
 * Each job of a workflow file by its name, as its text.
 *
 * @param {string} workflow
 * @returns {Map<string, string>}
 */
function workflowJobs(workflow) {
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));
  return new Map(
    jobs
      .split(/^ {2}(?=[\w-]+:$)/m)
      .slice(1)
      .map((job) => [job.slice(0, job.indexOf(':')), job]),
  );
}

test('the release installs dependencies only in a job that can read the repository and nothing more', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^permissions: \{\}$/m, 'no job gets a permission it does not name');
  const jobs = workflowJobs(workflow);
  assert.deepEqual(
    [...jobs.keys()],
    ['check', 'server-asset', 'channel', 'github-release', 'npm', 'purge-cdn-gh', 'purge-cdn-npm'],
  );
  const check = jobs.get('check') ?? '';
  assert.match(check, /permissions:\n {6}contents: read\n {4}steps:/, 'the check job only reads');
  assert.match(check, /- run: npm ci\n/);
  assert.match(check, /- run: npm run check\n/, 'the whole gate, not only the tests');
  for (const [name, job] of jobs) {
    if (name === 'check') continue;
    assert.doesNotMatch(job, /npm ci|npm run |run: npm install(?! -g npm@)/, `${name} runs no dependency's code`);
    if (job.includes('uses: actions/checkout@')) {
      assert.match(job, /persist-credentials: false/, `${name} keeps no token in the checkout`);
    }
  }
  const signers = [...jobs].filter(([, job]) => job.includes('id-token: write')).map(([name]) => name);
  assert.deepEqual(signers, ['server-asset', 'npm']);
  assert.match(jobs.get('server-asset') ?? '', /attestations: write/);
  assert.match(jobs.get('npm') ?? '', /npm publish --provenance --access public --ignore-scripts --tag "\$NPM_TAG"/);
});

test('the release creates the GitHub Release, which deployed copies wait for, before it publishes to npm', async () => {
  const jobs = workflowJobs(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  assert.match(jobs.get('github-release') ?? '', /needs: \[server-asset, channel\]/);
  assert.match(jobs.get('npm') ?? '', /needs: \[github-release, channel\]/);
});

test('the GitHub Release leaves out every script that imports a file beside it, which flat assets lose', async () => {
  const job = workflowJobs(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const [, filters] = /find dist -maxdepth 1 -type f(.*?) \| sort/.exec(job.get('github-release') ?? '') ?? [];
  assert.ok(filters !== undefined, 'the assets are the top-level files of dist/');
  const excluded = [...filters.matchAll(/! -name (\S+)/g)].map((match) => match[1]);
  /** @type {string[]} */
  const importing = [];
  for (const entry of await readdir(DIST, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    if (/\bfrom\s*['"]\.\.?\//.test(await readFile(join(DIST, entry.name), 'utf8'))) importing.push(entry.name);
  }
  assert.ok(importing.includes('tether.esm.js'), 'the ESM entry imports dist/esm/');
  assert.deepEqual(excluded.sort(), importing.sort());
});

test('the release refuses a tag outside main, or outside its release/X.Y branch, before it installs anything', async () => {
  const check =
    workflowJobs(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')).get('check') ??
    '';
  assert.match(check, /persist-credentials: false\n {10}fetch-depth: 0\n/, 'with the branches to compare against');
  const onBranch = check.indexOf('- name: Tag is on main, and on release/X.Y when that branch exists');
  assert.ok(onBranch !== -1 && onBranch < check.indexOf('- run: npm ci'), 'checked first');
  assert.match(check, /branches=\(main\)\n/);
  assert.match(check, /refs\/remotes\/origin\/release\/\$\{V%\.\*\}"[^\n]*branches\+=\("release\/\$\{V%\.\*\}"\)/);
  assert.match(check, /git merge-base --is-ancestor "\$GITHUB_SHA" "origin\/\$branch" \|\| \{[^}]*exit 1; \}/);
});

test("the smoke workflow's issue token is in a job that checks nothing out and runs no dependency", async () => {
  const workflow = await readFile(new URL('../.github/workflows/smoke.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^permissions: \{\}$/m);
  const jobs = workflowJobs(workflow);
  assert.deepEqual([...jobs.keys()], ['smoke', 'report']);
  const smoke = jobs.get('smoke') ?? '';
  assert.match(smoke, /permissions:\n {6}contents: read\n {4}outputs:/, 'the smoke job only reads');
  assert.match(smoke, /package-manager-cache: false/, 'no dependency cache from another run');
  const report = jobs.get('report') ?? '';
  assert.match(report, /permissions:\n {6}issues: write\n {4}steps:/);
  assert.doesNotMatch(report, /uses: |npm |node /, 'the report job runs no code of the repository or its dependencies');
});

test('only the newest release tag is marked latest, on GitHub and on npm', async () => {
  const jobs = workflowJobs(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const channel = jobs.get('channel') ?? '';
  assert.match(channel, /permissions:\n {6}contents: read\n/);
  assert.match(channel, /sort -V \| tail -n 1\)\n {10}if \[ "\$newest" = "\$V" \]; then\n/);
  assert.match(
    channel,
    /echo "latest=true"[^]*echo "npm-tag=latest"[^]*else[^]*echo "latest=false"[^]*echo "npm-tag=latest-\$\{V%\.\*\}"/,
  );
  assert.match(jobs.get('github-release') ?? '', /LATEST: \$\{\{ needs\.channel\.outputs\.latest \}\}/);
  assert.match(jobs.get('npm') ?? '', /NPM_TAG: \$\{\{ needs\.channel\.outputs\.npm-tag \}\}/);
});

test('the release rehearsal runs the gate at the next minor and patch versions, on pull requests that change code', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release-rehearsal.yml', import.meta.url), 'utf8');
  const [, trigger = ''] = /\non:\n([^]*?)\n\S/.exec(workflow) ?? [];
  assert.match(trigger, /^ {2}pull_request:\n {4}paths:\n/, 'pull requests only, by the files they change');
  for (const path of ['src/**', 'server/**', 'scripts/**', 'test/**', 'package.json', 'package-lock.json']) {
    assert.ok(trigger.includes(`- '${path}'`), `a change to ${path} runs it`);
  }
  assert.doesNotMatch(trigger, /push:/, 'not on every push to main');
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m, 'it only reads');
  const jobs = workflowJobs(workflow);
  assert.deepEqual([...jobs.keys()], ['rehearsal']);
  const job = jobs.get('rehearsal') ?? '';
  assert.match(job, /bump: \[minor, patch\]/);
  for (const [, action] of job.matchAll(/uses: (\S+)/g))
    assert.match(action ?? '', /@[0-9a-f]{40}$/, 'pinned by commit');
  assert.match(job, /persist-credentials: false/);
  assert.ok(job.includes('next="$major.$((minor + 1)).0"; else next="$major.$minor.$((patch + 1))"'));
  // The rewrite is release.ts's own, into a worktree, and the gate runs there.
  const rewrite = job.indexOf('scripts/release.ts --rewrite-only "$next" "$RUNNER_TEMP/next"');
  assert.ok(job.indexOf('git worktree add --detach "$RUNNER_TEMP/next" HEAD') < rewrite && rewrite !== -1);
  assert.match(job, /- run: npm ci\n {8}working-directory: \$\{\{ runner\.temp \}\}\/next\n/);
  assert.match(job, /- run: npm run check\n {8}working-directory: \$\{\{ runner\.temp \}\}\/next\n/);
  assert.ok(
    job.indexOf('release.ts --rewrite-only') < job.indexOf('- run: npm ci\n        working-directory:'),
    'the worktree is installed at the new version',
  );
  assert.ok(
    job.indexOf('- run: npm ci --ignore-scripts') < rewrite,
    'the checkout is installed before release.ts runs',
  );
});

test('the release relies on the ci run of the commit it releases, which runs on main and the release branches', async () => {
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /\n {2}push:\n {4}branches: \[main, 'release\/\*\*'\]\n/);
  const release = await readFile(new URL('../scripts/release.ts', import.meta.url), 'utf8');
  assert.ok(release.includes("'--workflow=ci.yml', `--commit=${sha}`"), 'asks GitHub for the ci runs of HEAD');
  assert.doesNotMatch(release, /run\('npm', \['run', 'check'\]\)/, 'the release leaves the whole gate to CI');
});

test("the release purges jsDelivr's gh/ aliases after the GitHub Release and its npm/ aliases after npm, warning on failure", async () => {
  const jobs = workflowJobs(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const gh = jobs.get('purge-cdn-gh') ?? '';
  const npm = jobs.get('purge-cdn-npm') ?? '';
  assert.match(
    gh,
    /needs: \[github-release, channel\]/,
    'the gh/ URLs come from the tag: a failed npm publish does not hold them back',
  );
  assert.match(gh, /PACKAGE: gh\/\$\{\{ github\.repository \}\}\n/);
  assert.match(npm, /needs: \[npm, channel\]/, 'once npm serves this version');
  assert.match(npm, /PACKAGE: npm\/@occluze\/tether\n/);
  const script = (/** @type {string} */ job) => job.slice(job.indexOf('run: |')).trimEnd();
  assert.equal(script(gh), script(npm), 'the same purge for both');
  for (const purge of [gh, npm]) {
    assert.match(purge, /permissions:\n {6}contents: read\n {4}steps:/, 'no token: the purge API is public');
    assert.match(purge, /LATEST: \$\{\{ needs\.channel\.outputs\.latest \}\}/);
  }
  const purge = script(gh);
  assert.match(purge, /aliases=\("@\$\{V%\.\*\}"\)\n/, 'every release purges its own @X.Y');
  assert.match(purge, /if \[ "\$LATEST" = true \]; then aliases\+=\("@\$\{V%%\.\*\}" "@latest" ""\); fi/);
  assert.match(purge, /"https:\/\/purge\.jsdelivr\.net\/\$PACKAGE\$alias\/\$file"/);
  assert.match(purge, /find dist -type f -not -path 'dist\/types\/\*'/, 'every file a browser loads from dist/');
  assert.match(purge, /curl -fsS --max-time 30 [^\n]*\|\|\n\s*echo "::warning::/, 'a failed purge warns');
});

test('CI and the pre-push hook lint the workflows with one script, at the versions .config/workflow-linters.json pins', async () => {
  const ci = workflowJobs(await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const job = ci.get('workflows') ?? '';
  assert.match(job, /run: node --experimental-strip-types scripts\/lint-workflows\.ts\n/);
  assert.match(job, /GH_TOKEN: \$\{\{ github\.token \}\}/, "zizmor's online audits");
  assert.doesNotMatch(job, /[0-9a-f]{64}|actionlint_|zizmor==|npm ci/, 'no version of its own, and no dependency');
  const lefthook = await readFile(new URL('../.config/lefthook.yml', import.meta.url), 'utf8');
  const [, prePush = ''] = /\npre-push:\n([^]*)/.exec(lefthook) ?? [];
  assert.match(prePush, /use_stdin: true\n {6}run: node --experimental-strip-types scripts\/pre-push\.ts\n/);
  assert.match(prePush, /run: npm run lint:workflows\n/);
  const pkg = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  assert.ok(pkg.includes('"lint:workflows": "node --experimental-strip-types scripts/lint-workflows.ts"'));
  const script = await readFile(new URL('../scripts/lint-workflows.ts', import.meta.url), 'utf8');
  assert.ok(script.includes("['.github/workflows', 'server/.github/workflows']"), 'and the workflow copies ship');

  const { default: linters } = await import('../.config/workflow-linters.json', { with: { type: 'json' } });
  assert.deepEqual(Object.keys(linters), ['actionlint', 'shellcheck', 'zizmor']);
  for (const [name, { version, platforms }] of Object.entries(linters)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} at an exact version`);
    assert.deepEqual(Object.keys(platforms).sort(), ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']);
    for (const { file, sha256 } of Object.values(platforms)) {
      assert.ok(file.includes(version), `${file} is ${name} ${version}`);
      assert.match(sha256, /^[0-9a-f]{64}$/);
    }
  }
});
