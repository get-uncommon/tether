// The real <script> build (npm test builds it into .test-dist/), loaded like a browser would: core + optional parts as files.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { assertLoadedWithIntegrity, builtPage, DIST } from './built-page.js';
import { fieldOf, waitFor, within } from '../server/test/mocks.js';

const PART_FILE = /^tether\.[\w-]+(\.min)?\.js$/;
/** The files `PART_FILE` matches that are no optional part. */
const CORES = new Set(['tether.min.js', 'tether.esm.js']);
/** The one product of the list's collection, which no `tether-product` on the page asks for. */
const teaBox = { ...structuredClone(product), id: 'gid://shopify/Product/2', handle: 'tea-box', title: 'Tea Box' };
/** @type {import('jsdom').DOMWindow} */
let win;
/** @type {{ op: string, query: string }[]} */
const ops = [];

before(
  async () => {
    const body = `
    <div tether-product="coffee-box"><h1 tether-bind="title"></h1><span id="price" tether-bind="price"></span></div>
    <select id="cs" tether-country-select></select>
    <div id="list" tether-collection="tea">
      <h2 tether-collection-bind="title"></h2>
      <div tether-list><div><span tether-bind="title"></span><span tether-bind="price"></span></div></div>
    </div>`;
    win = builtPage(
      "{ domain: 'shop.test', token: 't', autoMount: true }",
      body,
      'https://site.test/',
      async (_url, init) => {
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
          TetherCollection: () => ({
            collection: {
              id: 'gid://shopify/Collection/1',
              handle: 'tea',
              title: 'Tea',
              description: '',
              descriptionHtml: '',
              image: null,
              seo: { title: null, description: null },
              products: { nodes: [teaBox], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          }),
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
      },
    );
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
  await assertLoadedWithIntegrity(win, 'tether.markets.min.js');
  const script = [...win.document.scripts].find((element) => element.src.endsWith('tether.markets.min.js'));
  assert.equal(script?.crossOrigin, 'anonymous', 'the core is on another origin (file:) than the page');
});

test('a list loads the lists part from its own file, and its cards mount from the products it cached', async () => {
  const list = find('#list', win.document);
  await waitFor(() => list.getAttribute('tether-state') === 'ready', 'the list to render', 30_000);
  await assertLoadedWithIntegrity(win, 'tether.lists.min.js');
  assert.ok(partsOf(win)?.lists, 'registered');
  assert.equal(find('[tether-collection-bind="title"]', list).textContent, 'Tea');
  const card = find('[tether-product="tea-box"]', list);
  await waitFor(() => card.getAttribute('tether-state') === 'ready', 'the card to mount as a product scope', 30_000);
  assert.equal(find('[tether-bind="title"]', card).textContent, 'Tea Box');
  assert.match(find('[tether-bind="price"]', card).textContent, /\d/);
  assert.ok(
    ops.filter((sent) => sent.op === 'TetherProducts').every((sent) => !sent.query.includes('tea-box')),
    "the card used the core's cache, which the part primed",
  );
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
  // Each budget is a ceiling a build must stay under, with no headroom promised: growth past one is a decision, made by
  // moving code into a part or by raising the budget in the change that needs it. The build, not golfed source, keeps
  // the files small.
  assert.ok((await gz('tether.min.js')) < 28.75 * 1024, 'core gzip budget');
  assert.ok((await gz('tether.search.min.js')) < 3 * 1024);
  assert.ok((await gz('tether.lists.min.js')) < 2.75 * 1024, 'lists part budget');
  assert.ok((await gz('tether.account.min.js')) < 4.75 * 1024, 'account part budget');
  assert.ok((await gz('tether.account-pages.min.js')) < 6.75 * 1024, 'account pages part budget');
  assert.ok((await gz('tether.extras.min.js')) < 1.5 * 1024);
  assert.ok((await gz('tether.markets.min.js')) < 3 * 1024);
  assert.ok((await gz('tether.diagnose.min.js')) < 5.75 * 1024);
  assert.ok((await gz('tether.analytics.min.js')) < 3.5 * 1024);
});

test("the README's size badge and claims are the core's gzipped size", async () => {
  const { gzipSync } = await import('node:zlib');
  const readme = await readFile(join(DIST, '..', 'README.md'), 'utf8');
  const claims = [...readme.matchAll(/gzipped-(\d+(?:\.\d+)?)%20KB|(\d+(?:\.\d+)?) KB gzipped/g)].map(
    ([, badge, text]) => badge ?? text ?? '',
  );
  assert.ok(claims.length > 0, "the README's size badge (gzipped-N%20KB) is missing");
  const kilobytes = gzipSync(await readFile(join(DIST, 'tether.min.js')), { level: 9 }).length / 1024;
  for (const claim of claims) {
    // A claim is rounded to as many decimals as it is written with.
    const decimals = claim.split('.')[1]?.length ?? 0;
    const actual = kilobytes.toFixed(decimals);
    assert.equal(claim, actual, `the README says ${claim} KB; the core is ${kilobytes.toFixed(2)} KB: write ${actual}`);
  }
});

test("the docs' part sizes are each part's gzipped size", async () => {
  const { gzipSync } = await import('node:zlib');
  // The part each `N KB` in a doc names, in the order the doc says them: a new claim is added here.
  /** @type {Record<string, string[]>} */
  const claimed = {
    'accounts.md': ['account', 'account-pages'],
    'analytics.md': ['analytics'],
    'reference.md': ['lists', 'search'],
  };
  const docs = join(DIST, '..', 'docs');
  for (const doc of await readdir(docs)) {
    const claims = [...(await readFile(join(docs, doc), 'utf8')).matchAll(/(\d+(?:\.\d+)?) KB/g)].map(
      ([, n]) => n ?? '',
    );
    const parts = claimed[doc] ?? [];
    assert.equal(
      claims.length,
      parts.length,
      `${doc} has ${String(claims.length)} size claims; this test names ${String(parts.length)}`,
    );
    for (const [i, claim] of claims.entries()) {
      const part = `tether.${parts[i] ?? ''}.min.js`;
      const kilobytes = gzipSync(await readFile(join(DIST, part)), { level: 9 }).length / 1024;
      const actual = kilobytes.toFixed(claim.split('.')[1]?.length ?? 0);
      assert.equal(
        claim,
        actual,
        `${doc} says ${claim} KB for ${part}; it is ${kilobytes.toFixed(2)} KB: write ${actual}`,
      );
    }
  }
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
    /** @type {import('node:net').Socket[]} */
    const held = [];
    const silent = createServer((socket) => held.push(socket));
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
      // The request that timed out left its connection open on the server's side.
      for (const socket of held) socket.destroy();
      await new Promise((resolve) => silent.close(resolve));
    }
  },
);

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

test(
  "a build holds only its own files, and a part is the same bytes in every build and carries no version, so a release keeps an unchanged part's hash",
  {
    timeout: 60_000,
  },
  async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { VERSION } = await import('../src/version.ts');
    const again = await mkdtemp(join(tmpdir(), 'tether-build-'));
    try {
      // An earlier build's output, with a part and a preset this source no longer has, the temporary files of an
      // interrupted --watch, and the files Finder and Explorer leave in a folder.
      await mkdir(join(again, 'presets'));
      const stale = [
        'tether.min.js',
        'tether.oldpart.js',
        'tether.oldpart.min.js',
        'presets/old.esm.js',
        'tether.search.min.js.tmp-4242',
        'tether.min.js.map.tmp-4242',
        'tether.oldpart.js.tmp-4242',
      ];
      for (const file of [...stale, '.DS_Store', 'Thumbs.db', 'desktop.ini']) await writeFile(join(again, file), '');
      await promisify(execFile)(process.execPath, ['--experimental-strip-types', 'scripts/build.ts', '--out', again], {
        cwd: join(DIST, '..'),
        timeout: 60_000,
      });
      const names = (await readdir(join(DIST, '..', 'src', 'parts'))).map((file) => file.replace(/\.ts$/, ''));
      assert.deepEqual(
        [...(await readdir(again)), ...(await readdir(join(again, 'presets'))).map((file) => `presets/${file}`)].sort(),
        [
          'esm',
          'presets',
          'presets/barba.esm.js',
          'tether.esm.js',
          'tether.js',
          'tether.min.js',
          'tether.min.js.map',
          'types',
          ...names.flatMap((name) => [`tether.${name}.js`, `tether.${name}.min.js`]),
        ].sort(),
        'the build holds exactly its own files',
      );
      const parts = (await readdir(DIST)).filter((file) => PART_FILE.test(file) && !CORES.has(file));
      assert.ok(parts.includes('tether.diagnose.min.js') && parts.includes('tether.diagnose.js'), 'both kinds of part');
      for (const part of parts) {
        const built = await readFile(join(DIST, part));
        assert.ok(built.equals(await readFile(join(again, part))), `${part} is the same in both builds`);
        assert.ok(!built.includes(VERSION), `${part} does not say the version`);
      }
    } finally {
      await rm(again, { recursive: true, force: true });
    }
  },
);

test("the build refuses an output folder that holds files a build doesn't write, and leaves it as it was", async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const parent = await mkdtemp(join(tmpdir(), 'tether-build-'));
  const assets = join(parent, 'js');
  try {
    // A site's own asset folder, which self-hosts the script beside its own files.
    await mkdir(assets);
    await writeFile(join(assets, 'tether.min.js'), 'self-hosted');
    await writeFile(join(assets, 'site.js'), 'mine');
    // Named like a part, but no build writes it without its minified kind.
    await writeFile(join(assets, 'tether.config.js'), 'config');
    await writeFile(join(assets, '.DS_Store'), '');
    await assert.rejects(
      promisify(execFile)(process.execPath, ['--experimental-strip-types', 'scripts/build.ts', '--out', assets], {
        cwd: join(DIST, '..'),
        timeout: 60_000,
      }),
      /isn't a build's output folder \(it holds site\.js, tether\.config\.js\): not replacing it/,
    );
    assert.deepEqual((await readdir(assets)).sort(), ['.DS_Store', 'site.js', 'tether.config.js', 'tether.min.js']);
    assert.equal(await readFile(join(assets, 'tether.min.js'), 'utf8'), 'self-hosted');
    assert.deepEqual(await readdir(parent), ['js'], 'no build folder left next to it');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
