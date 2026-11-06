// The real <script> build with a `partsUrl`: parts from the site's own folder are pinned to the hashes built into the
// core, like the parts beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { graphqlRequest, jsonResponse, operationName } from './fixtures.js';

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
  const result = await win['Tether'].diagnose({ silent: true });
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
  assert.ok(win['Tether'].__parts.diagnose, 'registered');
  assert.equal(result.config.domain, 'shop.test');
});

test('a partsUrl on the site itself is hash-checked too, without CORS', async () => {
  const { script } = await loadDiagnoseFrom('/assets/tether/');
  assert.equal(script.src, 'https://site.test/assets/tether/tether.diagnose.min.js');
  assert.equal(script.integrity, await builtHash('tether.diagnose.min.js'));
  assert.equal(script.crossOrigin, null);
});

test('a part rejects its load when another script replaced window.Tether, instead of never settling', async () => {
  const win = await pageWithCore('https://cdn.test/tether/');
  const tether = win['Tether'];
  win['Tether'] = { version: 'another script' };
  await assert.rejects(tether.diagnose({ silent: true }), {
    message: /tether\.diagnose\.min\.js can't register: window\.Tether is no longer this Tether script's/,
  });
  win['Tether'] = tether;
  assert.equal((await tether.diagnose({ silent: true })).config.domain, 'shop.test', 'the next use tries again');
});
