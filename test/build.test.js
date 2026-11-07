// The real <script> build (npm test builds it into .test-dist/), loaded like a browser would: core + optional parts as files.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  builtTether,
  find,
  graphqlRequest,
  jsonResponse,
  operationName,
  pageLoaded,
  partsOf,
  product,
} from './fixtures.js';
import { fieldOf, waitFor, within } from '../server/test/mocks.js';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-dist');
/** @type {import('jsdom').DOMWindow} */
let win;
/** @type {{ op: string, query: string }[]} */
const ops = [];

before(
  async () => {
    const html = `<!doctype html><html lang="de"><head>
    <script>window.TETHER_CONFIG = { domain: 'shop.test', token: 't', autoMount: true };</script>
    <script src="${pathToFileURL(join(DIST, 'tether.min.js')).href}"></script>
  </head><body>
    <div tether-product="coffee-box"><h1 tether-bind="title"></h1><span id="price" tether-bind="price"></span></div>
    <select id="cs" tether-country-select></select>
  </body></html>`;
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(html, {
      url: 'https://site.test/',
      runScripts: 'dangerously',
      resources: 'usable',
      virtualConsole,
      beforeParse(window) {
        window.fetch = async (_url, init) => {
          const { query, variables } = graphqlRequest(init);
          const op = operationName(query);
          ops.push({ op, query });
          const data = {
            TetherProducts: () =>
              Object.fromEntries(
                Object.keys(variables)
                  .filter((key) => key.startsWith('h'))
                  .map((key) => [key, variables[key] === 'coffee-box' ? product : null]),
              ),
            TetherLocalization: () => ({
              localization: {
                country: { isoCode: 'NL', name: 'Netherlands', currency: { isoCode: 'EUR', symbol: '€' } },
                availableCountries: [
                  { isoCode: 'NL', name: 'Netherlands', currency: { isoCode: 'EUR', symbol: '€' } },
                  { isoCode: 'DE', name: 'Germany', currency: { isoCode: 'EUR', symbol: '€' } },
                ],
              },
            }),
            TetherDiagnose: () => ({
              shop: {
                name: 'Shop',
                primaryDomain: { url: 'https://shop.test' },
                paymentSettings: { currencyCode: 'EUR' },
              },
            }),
          }[op];
          if (!data) throw new Error(`unexpected ${op}`);
          return jsonResponse({ data: data() });
        };
      },
    });
    win = dom.window;
    await pageLoaded(win, 'the page with the built script');
    await waitFor(
      () => Boolean(partsOf(win)?.markets) && (win.document.querySelector('select')?.options.length ?? 0) > 1,
      'the markets part (its own file) to fill the country select',
      30_000,
    );
  },
  { timeout: 120_000 },
);

test('the built script renders a product (and its GraphQL is minified but valid-looking)', () => {
  assert.equal(find('h1', win.document).textContent, 'Coffee Box');
  const query = ops.find((sent) => sent.op === 'TetherProducts')?.query ?? '';
  assert.ok(!/\n| {2}/.test(query), 'no newlines or double spaces');
  assert.match(query, /fragment TetherProduct on Product\{id handle title/);
});

test('the markets part loads from its own file when the page has a country select', () => {
  const select = win.document.getElementById('cs');
  assert.ok(select instanceof win.HTMLSelectElement, 'the country select');
  assert.deepEqual(
    [...select.options].map((option) => option.value),
    ['DE', 'NL'],
  );
  assert.ok([...win.document.scripts].some((script) => script.src.endsWith('tether.markets.min.js')));
  assert.ok(partsOf(win)?.markets, 'registered');
});

test('a part beside the core loads with the integrity hash of the file built with it', async () => {
  const { createHash } = await import('node:crypto');
  const script = [...win.document.scripts].find((element) => element.src.endsWith('tether.markets.min.js'));
  assert.ok(script, 'the markets part has a script');
  const file = await readFile(join(DIST, 'tether.markets.min.js'));
  assert.equal(script.integrity, `sha384-${createHash('sha384').update(file).digest('base64')}`);
  assert.equal(script.crossOrigin, 'anonymous', 'the core is on another origin (file:) than the page');
});

test('the diagnose part loads on first call and shares the core (same config, same cache)', async () => {
  assert.ok(![...win.document.scripts].some((script) => script.src.includes('diagnose')), 'not loaded up front');
  const report = await within(30_000, builtTether(win).diagnose({ silent: true }), 'the diagnose part to report');
  assert.equal(report.reachable, true);
  assert.equal(report.config['domain'], 'shop.test');
  assert.equal(fieldOf(report.products[0], 'title'), 'Coffee Box');
  assert.ok(ops.filter((sent) => sent.op === 'TetherProducts').length === 1, 'diagnose used the cached product');
});

test('parts are small and the core is under budget', async () => {
  const { gzipSync } = await import('node:zlib');
  /** @param {string} file A file name in the test build. */
  const gz = async (file) => gzipSync(await readFile(join(DIST, file)), { level: 9 }).length;
  // The README promises a core of about 29 KB gzipped. Each budget sits about half a KB above today's build, so growth
  // is a decision; the build, not golfed source, keeps the files small.
  assert.ok((await gz('tether.min.js')) < 29.5 * 1024, 'core gzip budget');
  assert.ok((await gz('tether.search.min.js')) < 3 * 1024);
  assert.ok((await gz('tether.account.min.js')) < 4.75 * 1024, 'account part budget');
  assert.ok((await gz('tether.account-pages.min.js')) < 6.75 * 1024, 'account pages part budget');
  assert.ok((await gz('tether.extras.min.js')) < 1.5 * 1024);
  assert.ok((await gz('tether.markets.min.js')) < 3 * 1024);
  assert.ok((await gz('tether.diagnose.min.js')) < 5.75 * 1024);
  assert.ok((await gz('tether.analytics.min.js')) < 3.5 * 1024);
});

/**
 * Sends one HTTP request over a raw socket, so a path the URL parser would normalize reaches the server as written.
 *
 * @param {number} port
 * @param {string} path
 * @param {number} [idleMs] How long the server may stay silent before the request fails.
 * @returns {Promise<string>} The raw HTTP answer.
 */
const rawGet = (port, path, idleMs = 10_000) =>
  new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () =>
      socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`),
    );
    let out = '';
    socket.setTimeout(idleMs, () => {
      socket.destroy(new Error(`timed out after ${String(idleMs / 1000)}s waiting for the answer to GET ${path}`));
    });
    socket.on('data', (chunk) => {
      out += String(chunk);
    });
    socket.on('end', () => {
      resolve(out);
    });
    socket.on('error', reject);
  });

/**
 * Starts test/e2e/serve.mjs and waits until it listens, reading the port from what it prints, so the requests go to it
 * and not to whatever else holds a port: on Windows, the RPC ports of lsass and svchost listen on every interface and
 * take a connection without ever answering it.
 *
 * @param {string} port What `PORT` asks for: `0` lets the system pick a free port.
 * @returns {Promise<{ child: import('node:child_process').ChildProcess, port: number }>}
 */
async function startStaticServer(port) {
  const child = spawn(process.execPath, ['test/e2e/serve.mjs'], {
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  /** @type {Promise<number>} */
  const listening = new Promise((resolve, reject) => {
    let out = '';
    let errors = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
      const address = /^listening on http:\/\/127\.0\.0\.1:(\d+)\//m.exec(out);
      if (address) resolve(Number(address[1]));
    });
    child.stderr.on('data', (chunk) => {
      errors += String(chunk);
    });
    child.on('exit', (code) => {
      reject(new Error(`test/e2e/serve.mjs exited (${String(code)}) before it listened: ${errors}`));
    });
  });
  try {
    return { child, port: await within(30_000, listening, 'test/e2e/serve.mjs to listen') };
  } catch (error) {
    child.kill();
    throw error;
  }
}

test('e2e static server: stays inside its folders and listens on loopback only', { timeout: 60_000 }, async () => {
  const { child, port } = await startStaticServer('0');
  try {
    assert.match(await rawGet(port, '/plain/'), /^HTTP\/1\.1 /);
    for (const path of [
      '/plain/..%2F..%2Fpackage.json',
      '/..%2F..%2F..%2Fpackage.json',
      '/plain/dist/..%2F..%2Fpackage.json',
    ]) {
      const answer = await rawGet(port, path);
      assert.doesNotMatch(answer, /@occluze\/tether/, `${path} must not leave the served folder`);
      assert.match(answer, /^HTTP\/1\.1 (403|404)/);
    }
    assert.match(await rawGet(port, '/%E0%A4%A'), /^HTTP\/1\.1 400/, 'a malformed path is answered, not a crash');
  } finally {
    child.kill();
  }
});

test(
  'e2e static server: a port another process holds fails the start, and a server that never answers fails the request',
  { timeout: 60_000 },
  async () => {
    // Accepts connections and never answers, as the Windows RPC ports do.
    const silent = createServer(() => {});
    await within(
      10_000,
      new Promise((resolve) => {
        silent.listen(0, '127.0.0.1', () => {
          resolve(undefined);
        });
      }),
      'the silent server to listen',
    );
    const address = silent.address();
    assert.ok(address && typeof address === 'object');
    try {
      await assert.rejects(
        startStaticServer(String(address.port)),
        /serve\.mjs exited \(1\) before it listened: [^]*EADDRINUSE/,
      );
      await assert.rejects(rawGet(address.port, '/plain/', 200), {
        message: 'timed out after 0.2s waiting for the answer to GET /plain/',
      });
    } finally {
      silent.close();
    }
  },
);

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
  assert.deepEqual([...jobs.keys()], ['check', 'server-asset', 'channel', 'github-release', 'npm']);
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
  assert.ok(job.indexOf('release.ts --rewrite-only') < job.indexOf('- run: npm ci'), 'installed at the new version');
});

test('the release relies on the ci run of the commit it releases, which runs on main and the release branches', async () => {
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /\n {2}push:\n {4}branches: \[main, 'release\/\*\*'\]\n/);
  const release = await readFile(new URL('../scripts/release.ts', import.meta.url), 'utf8');
  assert.ok(release.includes("'--workflow=ci.yml', `--commit=${sha}`"), 'asks GitHub for the ci runs of HEAD');
  assert.doesNotMatch(release, /run\('npm', \['run', 'check'\]\)/, 'the release leaves the whole gate to CI');
});

test("the package exports its entry points and the browser scripts in dist/, and none of Tether's internal modules", () => {
  for (const entry of [
    '@occluze/tether',
    '@occluze/tether/server',
    '@occluze/tether/astro',
    '@occluze/tether/presets/barba',
    '@occluze/tether/dist/tether.min.js',
    '@occluze/tether/dist/tether.search.min.js',
    '@occluze/tether/dist/tether.esm.js',
  ]) {
    assert.ok(import.meta.resolve(entry), entry);
  }
  for (const internal of [
    '@occluze/tether/dist/esm/index.js',
    '@occluze/tether/dist/types/src/cart/store.d.ts',
    '@occluze/tether/dist/types/server/src/shared/json.d.ts',
    '@occluze/tether/dist/presets/barba.esm.js',
  ]) {
    assert.throws(() => import.meta.resolve(internal), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, internal);
  }
});
