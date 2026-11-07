// A jsdom page that loads the real <script> build (npm test builds it into .test-dist/), core and parts as files.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

export const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-dist');

/**
 * Opens a page that loads the built core from .test-dist/, and its parts from beside it.
 *
 * @param {string} config The `TETHER_CONFIG` object, as JavaScript.
 * @param {string} body
 * @param {string} url
 * @param {typeof globalThis.fetch} fetch The page's `fetch`.
 */
export function builtPage(config, body, url, fetch) {
  const html = `<!doctype html><html lang="de"><head>
    <script>window.TETHER_CONFIG = ${config};</script>
    <script src="${pathToFileURL(join(DIST, 'tether.min.js')).href}"></script>
  </head><body>${body}</body></html>`;
  return new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      window.fetch = fetch;
    },
  }).window;
}

/**
 * Asserts that the page loaded a part from its own file with the integrity hash of that file in the build.
 *
 * @param {import('jsdom').DOMWindow} window
 * @param {string} file
 */
export async function assertLoadedWithIntegrity(window, file) {
  const script = [...window.document.scripts].find((element) => element.src.endsWith(`/${file}`));
  assert.ok(script, `${file} has a script`);
  const built = await readFile(join(DIST, file));
  assert.equal(script.integrity, `sha384-${createHash('sha384').update(built).digest('base64')}`, file);
}
