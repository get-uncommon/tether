// scripts/watch-core.ts, which keeps a core's part hashes current while the build watches the sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rebuildUntilCurrent } from '../scripts/watch-core.ts';

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
