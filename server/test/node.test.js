// The Node-only parts: the state file store and the config file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { fileStore, loadConfig, takeOverStaleLock } from '../src/node.ts';
import { asRecord, parseJson, tempFolder, waitFor, within } from './mocks.js';

test('file store: a state file removed by another process leaves what this process holds', async (t) => {
  const dir = await tempFolder(t, 'tether-sync-');
  const path = join(dir, 'state.json');
  const store = fileStore(path, { delayMs: 10_000 });
  await store.put('cursor', 'x');
  await store.flush();
  await rm(path);
  assert.equal(await store.get('cursor'), 'x');
  await store.put('other', 1);
  await store.flush();
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { other: 1 }, 'the next write recreates the file');
});

test('file store: lists the keys under a prefix, with what another process wrote', async (t) => {
  const dir = await tempFolder(t, 'tether-sync-');
  const path = join(dir, 'state.json');
  const here = fileStore(path, { delayMs: 10_000 });
  const there = fileStore(path, { delayMs: 10_000 });
  await here.put('reconcile:retry:1:a', {});
  await here.put('reconcile:retry', []);
  await here.flush();
  await there.put('reconcile:retry:2:b', {});
  await there.flush();
  await here.delete('reconcile:retry:1:a');
  assert.deepEqual(await here.list('reconcile:retry:'), ['reconcile:retry:2:b']);
  await here.flush();
});

test('file store: a timed write that fails is logged, and kept for the next flush', async (t) => {
  const dir = await tempFolder(t, 'tether-sync-');
  /** @type {unknown[]} */
  const errors = [];
  const store = fileStore(join(dir, 'missing-dir', 'state.json'), {
    delayMs: 1,
    log: { error: (message) => errors.push(message) },
  });
  await store.put('k', 1);
  await waitFor(() => errors.length > 0, 'the timed write to fail');
  assert.equal(errors.length, 1);
  const [message] = errors;
  assert.ok(typeof message === 'string');
  assert.match(message, /write failed, retried on the next change/);
  await assert.rejects(store.flush(), 'the key is still waiting to be written');
});

test('file store: a state file that is not a JSON object is an error, never overwritten', async (t) => {
  const dir = await tempFolder(t, 'tether-sync-');
  const path = join(dir, 'state.json');
  await writeFile(path, '[1, 2]');
  const store = fileStore(path, { delayMs: 10_000 });
  await assert.rejects(store.get('k'), /does not hold a JSON object/);
  assert.equal(await readFile(path, 'utf8'), '[1, 2]');
});

/**
 * Starts another Node process with its own store on the state file at `path`. Sent the line `i`, it writes `other:i`
 * and flushes, and answers `i` once the write is on disk.
 *
 * @param {import('node:test').TestContext} t The process is ended when this test ends.
 * @param {string} path
 * @returns {Promise<(round: number) => Promise<void>>} Resolves once the process is ready.
 */
async function writerInAnotherProcess(t, path) {
  const store = pathToFileURL(join(import.meta.dirname, '../src/node.ts')).href;
  const script = `
    const { createInterface } = await import('node:readline');
    const { fileStore } = await import(${JSON.stringify(store)});
    const store = fileStore(${JSON.stringify(path)}, { delayMs: 10_000 });
    console.log('ready');
    for await (const round of createInterface({ input: process.stdin })) {
      await store.put('other:' + round, Number(round));
      await store.flush();
      console.log(round);
    }`;
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script],
    {
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  const exited = once(child, 'exit');
  t.after(async () => {
    child.stdin.end();
    if (child.exitCode === null) child.kill();
    await exited;
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const nextLine = async (/** @type {string} */ what) => (await within(30_000, lines.next(), what)).value;
  assert.equal(await nextLine('the other process to start'), 'ready');
  return async (round) => {
    child.stdin.write(`${String(round)}\n`);
    assert.equal(await nextLine(`the other process's write ${String(round)}`), String(round));
  };
}

test('file store: two processes writing at once both keep every key', async (t) => {
  const dir = await tempFolder(t, 'tether-sync-');
  const path = join(dir, 'state.json');
  const rounds = 40;
  const here = fileStore(path, { delayMs: 10_000 });
  const other = await writerInAnotherProcess(t, path);
  // Each round starts both writes together and ends once both are on disk, so every read, merge and rename in one
  // process meets one in the other: without the lock, one write of each pair would be lost.
  for (let i = 0; i < rounds; i++) {
    const theirs = other(i);
    await here.put(`here:${String(i)}`, i);
    await here.flush();
    await theirs;
  }
  const disk = asRecord(parseJson(await readFile(path, 'utf8')), 'the state file');
  assert.equal(Object.keys(disk).length, 2 * rounds, 'no write lost');
});

/** How long a write waits before it tries a held lock again: `LOCK_RETRY_MS` in src/node.ts. */
const LOCK_RETRY_MS = 20;

/**
 * Counts the waits of {@link LOCK_RETRY_MS} the code makes until `stop()`, which puts the real `setTimeout` back.
 *
 * @returns {{ count: () => number, stop: () => void }}
 */
function countLockWaits() {
  const start = globalThis.setTimeout;
  let waits = 0;
  /**
   * @param {() => void} callback
   * @param {number} [ms]
   */
  const counting = (callback, ms) => {
    if (ms === LOCK_RETRY_MS) waits += 1;
    return start(callback, ms);
  };
  // Defined, not assigned: the type of the global setTimeout is also the DOM's.
  Object.defineProperty(globalThis, 'setTimeout', { value: counting, writable: true, configurable: true });
  return {
    count: () => waits,
    stop: () => Object.defineProperty(globalThis, 'setTimeout', { value: start, writable: true, configurable: true }),
  };
}

test('file store: a write waits for the lock another process holds, and takes over one left by a dead process', async (t) => {
  const dir = await tempFolder(t, 'tether-sync-');
  const path = join(dir, 'state.json');
  const store = fileStore(path, { delayMs: 10_000 });
  await writeFile(`${path}.lock`, '');
  await store.put('k', 1);
  let written = false;
  const waits = countLockWaits();
  try {
    const flushed = store.flush().then(() => {
      written = true;
    });
    // Found the lock held, waited, and found it held again.
    await waitFor(() => waits.count() >= 2, 'the write to wait for the held lock twice');
    assert.equal(written, false, 'waits while the lock is held');
    await rm(`${path}.lock`);
    await within(30_000, flushed, 'the write to take the freed lock');
  } finally {
    waits.stop();
  }
  assert.deepEqual(parseJson(await readFile(path, 'utf8')), { k: 1 });

  await writeFile(`${path}.lock`, '');
  const longAgo = new Date(Date.now() - 3600e3);
  await utimes(`${path}.lock`, longAgo, longAgo);
  await store.put('k', 2);
  await within(30_000, store.flush(), 'the write to take over the stale lock');
  assert.deepEqual(parseJson(await readFile(path, 'utf8')), { k: 2 });

  const markers = async () => (await readdir(dir)).filter((name) => name.startsWith('state.json.lock.taken-'));
  const [marker] = await markers();
  assert.ok(marker, 'the takeover leaves its marker for the other waiters');
  await utimes(join(dir, marker), longAgo, longAgo);
  await store.put('k', 3);
  await within(30_000, store.flush(), 'the next write');
  assert.deepEqual(await markers(), [], 'the next write removes the old marker');
});

test('file store: of the waiters that find one lock stale, only the first takes it over', async (t) => {
  const dir = await tempFolder(t, 'tether-sync-');
  const lockPath = join(dir, 'state.json.lock');
  const longAgo = new Date(Date.now() - 3600e3);
  await writeFile(lockPath, '');
  await utimes(lockPath, longAgo, longAgo);
  const stale = await stat(lockPath);
  await takeOverStaleLock(lockPath, stale);
  await assert.rejects(stat(lockPath), { code: 'ENOENT' }, 'the first waiter removes the stale lock');
  await writeFile(lockPath, 'taken since');
  await takeOverStaleLock(lockPath, stale);
  assert.equal(await readFile(lockPath, 'utf8'), 'taken since', 'a waiter late with the same view leaves it alone');

  const [marker] = (await readdir(dir)).filter((name) => name.startsWith('state.json.lock.taken-'));
  assert.ok(marker, 'the takeover leaves a marker');
  await utimes(join(dir, marker), longAgo, longAgo);
  // A later lock goes stale at another time. Linux may give the new file the freed inode back, so with the same mtime
  // it would name the same marker as the first lock.
  const laterStale = new Date(longAgo.getTime() - 60e3);
  await utimes(lockPath, laterStale, laterStale);
  await takeOverStaleLock(lockPath, await stat(lockPath));
  assert.equal((await readdir(dir)).includes(marker), false, 'the next takeover removes an old marker');
});

test('file store: writes that all find the lock stale at once keep every key', async (t) => {
  const dir = await tempFolder(t, 'tether-sync-');
  const path = join(dir, 'state.json');
  const longAgo = new Date(Date.now() - 3600e3);
  await writeFile(`${path}.lock`, '');
  await utimes(`${path}.lock`, longAgo, longAgo);
  const stores = Array.from({ length: 8 }, () => fileStore(path, { delayMs: 10_000 }));
  await Promise.all(stores.map((store, i) => store.put(`k:${String(i)}`, i)));
  await Promise.all(stores.map((store) => store.flush()));
  const disk = asRecord(parseJson(await readFile(path, 'utf8')), 'the state file');
  assert.equal(Object.keys(disk).length, stores.length, 'no write lost');
});
test('config file: a value of the wrong type is named when the config loads', async (t) => {
  const dir = await tempFolder(t, 'tether-sync-');
  const path = join(dir, 'tether-sync.config.json');
  await writeFile(path, JSON.stringify({ shopify: { apiVersion: 202607 }, webflow: [], fields: { name: 'title' } }));
  await assert.rejects(loadConfig(path), /shopify\.apiVersion must be a string; webflow must be an object/);
  await writeFile(path, JSON.stringify({ shopify: { domain: 'shop.myshopify.com' }, fields: { name: 'title' } }));
  assert.equal((await loadConfig(path)).config.shopify?.domain, 'shop.myshopify.com');
});

test('file store: batched writes, merged with another process, survives a failed write', async (t) => {
  const dir = await tempFolder(t, 'tether-sync-');
  const path = join(dir, 'state.json');
  const first = fileStore(path, { delayMs: 10_000 });
  const second = fileStore(path, { delayMs: 10_000 });
  for (let i = 0; i < 100; i++) await first.put(`p:${i}`, { i });
  await second.put('reconcile:since', 'x');
  await second.flush();
  await first.flush();
  const disk = asRecord(parseJson(await readFile(path, 'utf8')), 'the state file');
  assert.equal(Object.keys(disk).length, 101, "both processes' keys are kept");
  assert.deepEqual(await second.get('p:5'), { i: 5 }, "the second store sees the first's writes");

  const bad = fileStore(join(dir, 'missing-dir', 'state.json'), { delayMs: 10_000 });
  await bad.put('k', 1);
  await assert.rejects(bad.flush());
  await assert.rejects(bad.flush(), 'still dirty, retried');
});
