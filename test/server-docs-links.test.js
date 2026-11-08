// A deployed Worker copy holds only server/, so a relative link in its docs must resolve inside server/;
// anything else in this repository is linked by its absolute URL on main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'server');
const ON_MAIN = 'https://github.com/ravi-klaassens/tether/blob/main/';
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;

async function serverDocs() {
  const docs = (await readdir(join(SERVER, 'docs'))).filter((name) => name.endsWith('.md'));
  return ['README.md', ...docs.map((name) => join('docs', name))].map((file) => join(SERVER, file));
}

/** @param {string} file */
async function linkTargets(file) {
  const markdown = await readFile(file, 'utf8');
  // The pattern's one group always takes part in a match.
  return [...markdown.matchAll(MARKDOWN_LINK)].map((match) => /** @type {string} */ (match[1]));
}

test("every relative link in the Worker's docs resolves to a file inside server/", async () => {
  const broken = [];
  for (const file of await serverDocs()) {
    for (const target of await linkTargets(file)) {
      if (/^[a-z]+:/.test(target) || target.startsWith('#')) continue;
      const path = resolve(dirname(file), target.replace(/#.*/, ''));
      const inside = !relative(SERVER, path).startsWith('..');
      if (!inside || !existsSync(path)) broken.push(`${relative(ROOT, file)}: ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("every link from the Worker's docs to a file on main names a file in this repository", async () => {
  const missing = [];
  for (const file of await serverDocs()) {
    for (const target of await linkTargets(file)) {
      if (!target.startsWith(ON_MAIN)) continue;
      const path = join(ROOT, target.slice(ON_MAIN.length).replace(/#.*/, ''));
      if (!existsSync(path)) missing.push(`${relative(ROOT, file)}: ${target}`);
    }
  }
  assert.deepEqual(missing, []);
});
