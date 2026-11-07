// The real <script> build with a `partsUrl`, or at a jsDelivr version alias: parts from another folder are pinned to the
// hashes built into the core, like the parts beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { builtTether, graphqlRequest, jsonResponse, operationName, partsOf } from './fixtures.js';
import { exactReleaseFolder } from '../src/lazy-iife.ts';
import { VERSION } from '../src/version.ts';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-dist');
const PART_FILE = /^https:\/\/(?:cdn|site)\.test\/[\w/]*\/(tether\.[\w.-]+\.js)$/;

/** Serves the built files at the `partsUrl` folders the tests use. */
class PartsHost extends ResourceLoader {
  /**
   * @override
   * @param {string} url
   * @param {import('jsdom').FetchOptions} options
   */
  fetch(url, options) {
    const file = PART_FILE.exec(url)?.[1];
    if (!file) return super.fetch(url, options);
    return Object.assign(readFile(join(DIST, file)), { abort: () => {} });
  }
}

/**
 * Answers the Storefront queries Tether.diagnose() sends.
 *
 * @param {import('jsdom').DOMWindow} window
 */
function storefront(window) {
  window.fetch = async (_url, init) => {
    const { query } = graphqlRequest(init);
    const op = operationName(query);
    const data = {
      TetherDiagnose: { shop: { name: 'Shop', primaryDomain: { url: 'https://shop.test' }, paymentSettings: {} } },
      TetherProducts: {},
    }[op];
    return jsonResponse({ data });
  };
}

/**
 * Loads the built core with `partsUrl` into a page.
 *
 * @param {string} partsUrl
 */
async function pageWithCore(partsUrl) {
  const html = `<!doctype html><html><head>
    <script>window.TETHER_CONFIG = ${JSON.stringify({ domain: 'shop.test', token: 't', partsUrl })};</script>
    <script src="${pathToFileURL(join(DIST, 'tether.min.js')).href}"></script>
  </head><body></body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://site.test/',
    runScripts: 'dangerously',
    resources: new PartsHost(),
    virtualConsole: new VirtualConsole(),
    beforeParse: storefront,
  });
  const win = dom.window;
  await new Promise((resolve) => {
    win.addEventListener('load', resolve);
  });
  return win;
}

/**
 * Loads the built core with `partsUrl`, asks for the diagnose part, and returns its `<script>` once it registered.
 *
 * @param {string} partsUrl
 */
async function loadDiagnoseFrom(partsUrl) {
  const win = await pageWithCore(partsUrl);
  const result = await builtTether(win).diagnose({ silent: true });
  const script = [...win.document.scripts].find((element) => element.src.endsWith('tether.diagnose.min.js'));
  assert.ok(script, 'the diagnose part has a script');
  return { win, script, result };
}

/** @param {string} file A file name in the test build. */
async function builtHash(file) {
  return `sha384-${createHash('sha384')
    .update(await readFile(join(DIST, file)))
    .digest('base64')}`;
}

test('a cross-origin partsUrl loads parts with the hash built into the core, over CORS', async () => {
  const { win, script, result } = await loadDiagnoseFrom('https://cdn.test/tether/');
  assert.equal(script.src, 'https://cdn.test/tether/tether.diagnose.min.js');
  assert.equal(script.integrity, await builtHash('tether.diagnose.min.js'));
  assert.equal(script.crossOrigin, 'anonymous');
  assert.ok(partsOf(win)?.diagnose, 'registered');
  assert.equal(result.config['domain'], 'shop.test');
});

test('a partsUrl on the site itself is hash-checked too, without CORS', async () => {
  const { script } = await loadDiagnoseFrom('/assets/tether/');
  assert.equal(script.src, 'https://site.test/assets/tether/tether.diagnose.min.js');
  assert.equal(script.integrity, await builtHash('tether.diagnose.min.js'));
  assert.equal(script.crossOrigin, null);
});

test('a part rejects its load when another script replaced window.Tether, instead of never settling', async () => {
  const win = await pageWithCore('https://cdn.test/tether/');
  const tether = builtTether(win);
  win['Tether'] = { version: 'another script' };
  await assert.rejects(tether.diagnose({ silent: true }), {
    message: /tether\.diagnose\.min\.js can't register: window\.Tether is no longer this Tether script's/,
  });
  win['Tether'] = tether;
  assert.equal((await tether.diagnose({ silent: true })).config['domain'], 'shop.test', 'the next use tries again');
});

test('a jsDelivr version alias in the core URL becomes the release the core was built as', () => {
  const gh = 'https://cdn.jsdelivr.net/gh/ravi-klaassens/tether';
  const npm = 'https://cdn.jsdelivr.net/npm/@occluze/tether';
  for (const alias of ['@0.8', '@0', '@latest', '']) {
    assert.equal(exactReleaseFolder(`${gh}${alias}/dist/`), `${gh}@v${VERSION}/dist/`, `gh${alias}`);
    assert.equal(exactReleaseFolder(`${gh}${alias}/`), `${gh}@v${VERSION}/`, `gh${alias} without dist/`);
    assert.equal(exactReleaseFolder(`${npm}${alias}/dist/`), `${npm}@${VERSION}/dist/`, `npm${alias}`);
    assert.equal(exactReleaseFolder(`${npm}${alias}/`), `${npm}@${VERSION}/`, `npm${alias} without dist/`);
  }
  for (const folder of [
    `${gh}@v0.8.0/dist/`,
    `${gh}@0.8.0/dist/`,
    `${gh}@main/dist/`,
    `${npm}@0.8.0/dist/`,
    'https://site.test/assets/tether/',
    // A local server, like the browser tests' (test/e2e/serve.mjs), and a site's own domain with a range-like folder.
    'http://127.0.0.1:4399/plain/dist/',
    'https://shop.example/js/tether@0.8/dist/',
    'https://unpkg.com/@occluze/tether@0.8/dist/',
  ]) {
    assert.equal(exactReleaseFolder(folder), folder);
  }
});

/**
 * Serves fixed files by URL, and refuses a script whose bytes don't match its `integrity`, as a browser does.
 */
class CheckingHost extends ResourceLoader {
  /** @param {Map<string, Buffer>} files */
  constructor(files) {
    super();
    this.files = files;
  }

  /**
   * @override
   * @param {string} url
   * @param {import('jsdom').FetchOptions} options
   */
  fetch(url, options) {
    const bytes = this.files.get(url);
    if (!bytes) return super.fetch(url, options);
    // The page fetches only scripts, and jsdom keeps `integrity` as the property the core sets, not as an attribute.
    const integrity = /** @type {HTMLScriptElement | undefined} */ (options.element)?.integrity;
    const hash = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
    const served = integrity && integrity !== hash ? Promise.reject(new Error(`${url} fails ${integrity}`)) : bytes;
    return Object.assign(Promise.resolve(served), { abort: () => {} });
  }
}

/**
 * jsDelivr's cache after a release: the core at a version alias, the alias's part from another release (its bytes
 * differ, so its hash does), and the core's own release at its exact folder.
 *
 * @param {{ core: string, exactFolder: string, minified: boolean, partsUrl?: string }} options
 */
async function pageWithMixedCache({ core, exactFolder, minified, partsUrl }) {
  const suffix = minified ? '.min' : '';
  const part = `tether.diagnose${suffix}.js`;
  const built = await readFile(join(DIST, part));
  const aliasFolder = core.replace(/[^/]*$/, '');
  const files = new Map([
    [core, await readFile(join(DIST, `tether${suffix}.js`))],
    [`${aliasFolder}${part}`, Buffer.concat([built, Buffer.from('\n// another release\n')])],
    [`${exactFolder}${part}`, built],
  ]);
  const config = { domain: 'shop.test', token: 't', ...(partsUrl ? { partsUrl } : {}) };
  const html = `<!doctype html><html><head>
    <script>window.TETHER_CONFIG = ${JSON.stringify(config)};</script>
    <script src="${core}"></script>
  </head><body></body></html>`;
  const dom = new JSDOM(html, {
    url: 'https://site.test/',
    runScripts: 'dangerously',
    resources: new CheckingHost(files),
    virtualConsole: new VirtualConsole(),
    beforeParse: storefront,
  });
  const win = dom.window;
  await new Promise((resolve) => {
    win.addEventListener('load', resolve);
  });
  return { win, part };
}

/** Bounds every wait in a test that loads pages. */
const PAGE_TEST = { timeout: 10_000 };

test('a core at a jsDelivr range loads its parts from its exact release, not from the range', PAGE_TEST, async () => {
  const cases = [
    {
      core: 'https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@0.8/dist/tether.min.js',
      exactFolder: `https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@v${VERSION}/dist/`,
      minified: true,
    },
    {
      core: 'https://cdn.jsdelivr.net/npm/@occluze/tether@latest/dist/tether.js',
      exactFolder: `https://cdn.jsdelivr.net/npm/@occluze/tether@${VERSION}/dist/`,
      minified: false,
    },
  ];
  for (const { core, exactFolder, minified } of cases) {
    const { win, part } = await pageWithMixedCache({ core, exactFolder, minified });
    const result = await builtTether(win).diagnose({ silent: true });
    assert.equal(result.config['domain'], 'shop.test', core);
    const script = [...win.document.scripts].find((element) => element.src.endsWith(part));
    assert.equal(script?.src, `${exactFolder}${part}`);
    assert.ok(partsOf(win)?.diagnose, 'registered');
  }
});

test('a partsUrl is used as given, even at a jsDelivr range', PAGE_TEST, async () => {
  const core = 'https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@0.8/dist/tether.min.js';
  const exactFolder = `https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@v${VERSION}/dist/`;
  const partsUrl = 'https://cdn.jsdelivr.net/gh/ravi-klaassens/tether@0.8/dist/';
  const { win } = await pageWithMixedCache({ core, exactFolder, minified: true, partsUrl });
  await assert.rejects(builtTether(win).diagnose({ silent: true }), {
    message:
      /^Could not load https:\/\/cdn\.jsdelivr\.net\/gh\/ravi-klaassens\/tether@0\.8\/dist\/tether\.diagnose\.min\.js,/,
  });
});
