// The real <script> build (npm test builds it into .test-dist/), loaded like a browser would: core + optional parts as files.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { find, graphqlRequest, jsonResponse, operationName, product } from './fixtures.js';
import { waitFor } from '../server/test/mocks.js';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-dist');
/** @type {import('jsdom').DOMWindow} */
let win;
/** @type {{ op: string, query: string }[]} */
const ops = [];

before(async () => {
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
  await new Promise((resolve) => win.addEventListener('load', resolve));
  await waitFor(
    () => Boolean(win['Tether']?.__parts?.markets) && (win.document.querySelector('select')?.options.length ?? 0) > 1,
    'the markets part (its own file) to fill the country select',
  );
});

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
  assert.ok([...win.document.scripts].some((script) => /tether\.markets\.min\.js$/.test(script.src)));
  assert.ok(win['Tether'].__parts.markets, 'registered');
});

test('a part beside the core loads with the integrity hash of the file built with it', async () => {
  const { createHash } = await import('node:crypto');
  const script = [...win.document.scripts].find((element) => /tether\.markets\.min\.js$/.test(element.src));
  assert.ok(script, 'the markets part has a script');
  const file = await readFile(join(DIST, 'tether.markets.min.js'));
  assert.equal(script.integrity, `sha384-${createHash('sha384').update(file).digest('base64')}`);
  assert.equal(script.crossOrigin, 'anonymous', 'the core is on another origin (file:) than the page');
});

test('the diagnose part loads on first call and shares the core (same config, same cache)', async () => {
  assert.ok(![...win.document.scripts].some((script) => /diagnose/.test(script.src)), 'not loaded up front');
  const report = await win['Tether'].diagnose({ silent: true });
  assert.equal(report.reachable, true);
  assert.equal(report.config.domain, 'shop.test');
  assert.equal(report.products[0].title, 'Coffee Box');
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

test('e2e static server: stays inside its folders and listens on loopback only', async () => {
  const { spawn } = await import('node:child_process');
  const { connect } = await import('node:net');
  const port = 40000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['e2e/serve.mjs'], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  /**
   * @param {string} path
   * @returns {Promise<string>} The raw HTTP answer, or `ERR` when the server isn't listening.
   */
  const get = (path) =>
    new Promise((resolve) => {
      const socket = connect(port, '127.0.0.1', () =>
        socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`),
      );
      let out = '';
      socket.on('data', (chunk) => {
        out += chunk;
      });
      socket.on('end', () => resolve(out));
      socket.on('error', () => resolve('ERR'));
    });
  try {
    let first = 'ERR';
    for (let i = 0; i < 40 && first === 'ERR'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      first = await get('/plain/');
    }
    for (const path of [
      '/plain/..%2F..%2Fpackage.json',
      '/..%2F..%2F..%2Fpackage.json',
      '/plain/dist/..%2F..%2Fpackage.json',
    ]) {
      const answer = await get(path);
      assert.doesNotMatch(answer, /@occluze\/tether/, `${path} must not leave the served folder`);
      assert.match(answer, /^HTTP\/1\.1 (403|404)/);
    }
    assert.match(await get('/%E0%A4%A'), /^HTTP\/1\.1 400/, 'a malformed path is answered, not a crash');
  } finally {
    child.kill();
  }
});

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
  const signers = [...jobs].filter(([, job]) => /id-token: write/.test(job)).map(([name]) => name);
  assert.deepEqual(signers, ['server-asset', 'npm']);
  assert.match(jobs.get('server-asset') ?? '', /attestations: write/);
  assert.match(jobs.get('npm') ?? '', /npm publish --provenance --access public --ignore-scripts --tag "\$NPM_TAG"/);
});

test('the release creates the GitHub Release, which deployed copies wait for, before it publishes to npm', async () => {
  const jobs = workflowJobs(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  assert.match(jobs.get('github-release') ?? '', /needs: \[server-asset, channel\]/);
  assert.match(jobs.get('npm') ?? '', /needs: \[github-release, channel\]/);
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
