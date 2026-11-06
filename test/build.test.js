// The real <script> build (npm test builds it into .test-dist/), loaded like a browser would: core + optional parts as files.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { product } from './fixtures.js';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-dist');
let win;
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
    beforeParse(w) {
      w.fetch = async (url, init) => {
        const { query, variables } = JSON.parse(init.body);
        const op = query.match(/(?:query|mutation)\s+(\w+)/)[1];
        ops.push({ op, query });
        const data = {
          TetherProducts: () =>
            Object.fromEntries(
              Object.keys(variables)
                .filter((k) => k.startsWith('h'))
                .map((k) => [k, variables[k] === 'coffee-box' ? product : null]),
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
        return { ok: true, status: 200, json: async () => ({ data: data() }) };
      };
    },
  });
  win = dom.window;
  await new Promise((r) => win.addEventListener('load', r));
  // Wait for the markets part (its own file) instead of a fixed time: CI runners can be slow.
  for (
    let i = 0;
    i < 100 && !(win.Tether?.__parts?.markets && win.document.getElementById('cs')?.options.length > 1);
    i++
  ) {
    await new Promise((r) => setTimeout(r, 50));
  }
});

test('the built script renders a product (and its GraphQL is minified but valid-looking)', () => {
  assert.equal(win.document.querySelector('h1').textContent, 'Coffee Box');
  const q = ops.find((o) => o.op === 'TetherProducts').query;
  assert.ok(!/\n|  /.test(q), 'no newlines or double spaces');
  assert.match(q, /fragment TetherProduct on Product\{id handle title/);
});

test('the markets part loads from its own file when the page has a country select', () => {
  const s = win.document.getElementById('cs');
  assert.deepEqual(
    [...s.options].map((o) => o.value),
    ['DE', 'NL'],
  );
  assert.ok([...win.document.scripts].some((x) => /tether\.markets\.min\.js$/.test(x.src)));
  assert.ok(win.Tether.__parts.markets, 'registered');
});

test('the diagnose part loads on first call and shares the core (same config, same cache)', async () => {
  assert.ok(![...win.document.scripts].some((x) => /diagnose/.test(x.src)), 'not loaded up front');
  const r = await win.Tether.diagnose({ silent: true });
  assert.equal(r.reachable, true);
  assert.equal(r.config.domain, 'shop.test');
  assert.equal(r.products[0].title, 'Coffee Box');
  assert.ok(ops.filter((o) => o.op === 'TetherProducts').length === 1, 'diagnose used the cached product');
});

test('parts are small and the core is under budget', async () => {
  const { gzipSync } = await import('node:zlib');
  const gz = async (f) => gzipSync(await readFile(join(DIST, f)), { level: 9 }).length;
  // The README promises a core of about 20 KB gzipped.
  assert.ok((await gz('tether.min.js')) < 20.7 * 1024, 'core gzip budget');
  assert.ok((await gz('tether.search.min.js')) < 3 * 1024);
  assert.ok((await gz('tether.account.min.js')) < 5 * 1024);
  assert.ok((await gz('tether.account-pages.min.js')) < 7 * 1024); // order page, addresses, subscriptions, returns: only on those pages
  assert.ok((await gz('tether.extras.min.js')) < 1.5 * 1024);
  assert.ok((await gz('tether.markets.min.js')) < 3 * 1024);
  assert.ok((await gz('tether.diagnose.min.js')) < 6 * 1024); // console only, loaded on demand; knows every attribute for did-you-mean
});

test('e2e static server: stays inside its folders and listens on loopback only', async () => {
  const { spawn } = await import('node:child_process');
  const { connect } = await import('node:net');
  const port = 40000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['e2e/serve.mjs'], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  const get = (path) =>
    new Promise((resolve) => {
      const s = connect(port, '127.0.0.1', () =>
        s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`),
      );
      let out = '';
      s.on('data', (d) => {
        out += d;
      });
      s.on('end', () => resolve(out));
      s.on('error', () => resolve('ERR'));
    });
  try {
    let first = 'ERR';
    for (let i = 0; i < 40 && first === 'ERR'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      first = await get('/plain/');
    }
    for (const p of [
      '/plain/..%2F..%2Fpackage.json',
      '/..%2F..%2F..%2Fpackage.json',
      '/plain/dist/..%2F..%2Fpackage.json',
    ]) {
      const res = await get(p);
      assert.doesNotMatch(res, /@occluze\/tether/, `${p} must not leave the served folder`);
      assert.match(res, /^HTTP\/1\.1 (403|404)/);
    }
    assert.match(await get('/%E0%A4%A'), /^HTTP\/1\.1 400/, 'a malformed path is answered, not a crash');
  } finally {
    child.kill();
  }
});
