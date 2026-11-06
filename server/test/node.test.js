// The Node-only parts: the state file store and the config file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore, loadConfig } from '../src/node.ts';
import { waitFor } from './mocks.js';

test('file store: a state file removed by another process leaves what this process holds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tether-sync-'));
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

test('file store: a timed write that fails is logged, and kept for the next flush', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tether-sync-'));
  const errors = [];
  const store = fileStore(join(dir, 'missing-dir', 'state.json'), {
    delayMs: 1,
    log: { error: (message) => errors.push(message) },
  });
  await store.put('k', 1);
  await waitFor(() => errors.length > 0, 'the timed write to fail');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /write failed, retried on the next change/);
  await assert.rejects(store.flush(), 'the key is still waiting to be written');
});

test('file store: a state file that is not a JSON object is an error, never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tether-sync-'));
  const path = join(dir, 'state.json');
  await writeFile(path, '[1, 2]');
  const store = fileStore(path, { delayMs: 10_000 });
  await assert.rejects(store.get('k'), /does not hold a JSON object/);
  assert.equal(await readFile(path, 'utf8'), '[1, 2]');
});

test('config file: a value of the wrong type is named when the config loads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tether-sync-'));
  const path = join(dir, 'tether-sync.config.json');
  await writeFile(path, JSON.stringify({ shopify: { apiVersion: 202607 }, webflow: [], fields: { name: 'title' } }));
  await assert.rejects(loadConfig(path), /shopify\.apiVersion must be a string; webflow must be an object/);
  await writeFile(path, JSON.stringify({ shopify: { domain: 'shop.myshopify.com' }, fields: { name: 'title' } }));
  assert.equal((await loadConfig(path)).config.shopify?.domain, 'shop.myshopify.com');
});
