// The build's --watch: scripts/watch-core.ts, which keeps a core's part hashes current, and the watch it runs in
// (`watchScripts` in scripts/script-build.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stop } from 'esbuild';
import { PARTS, buildScripts, watchKind } from '../scripts/script-build.ts';
import { rebuildUntilCurrent } from '../scripts/watch-core.ts';
import { tempFolder } from '../server/test/mocks.js';

const ROOT = join(import.meta.dirname, '..');
/** How long a watched edit may take to reach every file it changes: esbuild polls the sources. */
const SETTLE_MS = 30_000;
const POLL_MS = 100;

test('in --watch, a core rebuilds until it embeds the part hashes on disk, though a rebuild joins a running build', async () => {
  const file = 'tether.search.min.js';
  let onDisk = 'sha384-old';
  /** @type {Record<string, string> | undefined} */
  let embedded;
  /** @type {Promise<void> | undefined} */
  let running;
  let builds = 0;
  // A fake core context: a build reads the part's hash when it starts, as `partIntegrityPlugin` does, and `rebuild()`
  // during a build resolves with that build, as esbuild's does.
  const startBuild = () => {
    builds += 1;
    embedded = { [file]: onDisk };
    running = new Promise((resolve) => setImmediate(resolve)).then(() => {
      running = undefined;
    });
    return running;
  };
  const rebuild = () => running ?? startBuild();
  const current = async () => ({ [file]: onDisk });

  // A source both the core and the part bundle changed: the core's build starts first, then the part rewrites its file.
  void startBuild();
  onDisk = 'sha384-new';
  await rebuildUntilCurrent(rebuild, () => embedded, current);
  assert.deepEqual(embedded, { [file]: 'sha384-new' });
  assert.equal(builds, 2, 'the joined build, then one that read the new file');

  await rebuildUntilCurrent(rebuild, () => embedded, current);
  assert.equal(builds, 3, 'one build when the hashes are already current');
});

/**
 * @param {string} out
 * @param {boolean} minified Which core: tether.min.js, or tether.js.
 * @returns {Promise<string | null>} Why the core doesn't yet carry the hashes of the part files of its kind, or null
 *   when it does, read as a browser would: the map the core embeds against the files beside it.
 */
async function staleCore(out, minified) {
  const suffix = minified ? '.min' : '';
  const core = `tether${suffix}.js`;
  const text = await readFile(join(out, core), 'utf8');
  /** @type {Map<string | undefined, string | undefined>} */
  const embedded = new Map();
  for (const [, file, hash] of text.matchAll(/"(tether\.[\w.-]+\.js)": ?"(sha384-[^"]+)"/g)) embedded.set(file, hash);
  for (const file of PARTS.map((name) => `tether.${name}${suffix}.js`)) {
    const hash = `sha384-${createHash('sha384')
      .update(await readFile(join(out, file)))
      .digest('base64')}`;
    if (embedded.get(file) !== hash)
      return `${core} embeds ${String(embedded.get(file))} for ${file}, which is ${hash}`;
  }
  return null;
}

/**
 * Waits until every file in `files` holds `marker` and the core of the kind carries its parts' hashes.
 *
 * @param {string} out
 * @param {boolean} minified
 * @param {string[]} files
 * @param {string} marker
 */
async function settled(out, minified, files, marker) {
  const deadline = Date.now() + SETTLE_MS;
  let problem = 'not read yet';
  while (Date.now() < deadline) {
    try {
      const missing = [];
      for (const file of files) if (!(await readFile(join(out, file), 'utf8')).includes(marker)) missing.push(file);
      problem = missing.length ? `${missing.join(', ')} without ${marker}` : ((await staleCore(out, minified)) ?? '');
      if (!problem) return;
    } catch (error) {
      // A file the watch is replacing, which Windows doesn't let a reader open.
      problem = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  assert.fail(`the watch didn't settle in ${String(SETTLE_MS)} ms: ${problem}`);
}

test(
  'in --watch, an edit to a part or to a source the core shares with it leaves the core with the hashes of its own kind of part',
  { timeout: 5 * SETTLE_MS },
  async (t) => {
    const root = await tempFolder(t, 'tether-watch-');
    const src = join(root, 'src');
    const out = join(root, 'out');
    await cp(join(ROOT, 'src'), src, { recursive: true });
    await cp(join(ROOT, 'server', 'src', 'shared'), join(root, 'server', 'src', 'shared'), { recursive: true });
    // A module of the copy's own that the core and the search part both bundle.
    const shared = join(src, 'shared-probe.ts');
    await writeFile(shared, "console.debug('watch-initial');\n");
    for (const entry of ['index.ts', join('parts', 'search.ts')]) {
      const file = join(src, entry);
      const imported = entry === 'index.ts' ? './shared-probe.ts' : '../shared-probe.ts';
      await writeFile(file, `import '${imported}';\n${await readFile(file, 'utf8')}`);
    }
    await mkdir(out);
    await buildScripts(src, out);
    // One kind at a time: both kinds of a part rebuild on every edit, so with both watched, a part wired to the other
    // kind's core could still leave each core current.
    for (const minified of [false, true]) {
      const suffix = minified ? '.min' : '';
      const part = `tether.search${suffix}.js`;
      const stopWatching = await watchKind(src, out, minified);
      try {
        await appendFile(join(src, 'parts', 'search.ts'), `\nconsole.debug('watch-part${suffix}');\n`);
        await settled(out, minified, [part], `watch-part${suffix}`);
        await writeFile(shared, `console.debug('watch-shared${suffix}');\n`);
        await settled(out, minified, [part, `tether${suffix}.js`], `watch-shared${suffix}`);
      } finally {
        // Before `tempFolder` removes the sources the watch reads.
        await stopWatching();
      }
    }
    await stop();
  },
);
