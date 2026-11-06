// The Worker around the sync: its KV namespace, the cron's failures, and what /check says about both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import defaultConfig from './default-config.js';
import { createWorker } from '../src/index.js';
import { createMockApis, shopifyProduct, instantSleep } from './mocks.js';

const SECRET = 'a-long-random-sync-secret-123';
const env = {
  SHOPIFY_DOMAIN: 'shop.myshopify.com',
  WEBFLOW_COLLECTION_ID: '0123456789abcdef01234567',
  WEBFLOW_TOKEN: 'wf',
  SHOPIFY_CLIENT_ID: 'cid',
  SHOPIFY_CLIENT_SECRET: 'csecret',
  SYNC_SECRET: SECRET,
  FIELD_MAP: 'none',
};
const auth = { authorization: `Bearer ${SECRET}` };

/** A KV namespace in memory. */
function kv() {
  const map = new Map();
  return {
    map,
    get: async (key) => map.get(key) ?? null,
    put: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
  };
}

/** Runs `body` with console.error collected instead of printed. */
async function collectErrors(body) {
  const lines = [];
  const realError = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try {
    await body();
  } finally {
    console.error = realError;
  }
  return lines;
}

test('without the TETHER_SYNC namespace, POST /reconcile refuses to run and says why', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const worker = createWorker(defaultConfig, { fetch: apis.fetch, sleep: instantSleep });
  let response;
  const logged = await collectErrors(async () => {
    response = await worker.fetch(new Request('https://w.test/reconcile', { method: 'POST', headers: auth }), env, {});
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /TETHER_SYNC/);
  assert.ok(logged.some((line) => /reconcile: the TETHER_SYNC KV namespace is not bound/.test(line)));
  assert.equal(apis.calls.length, 0, 'nothing is synced into a store that forgets it');
});

test('the cron logs a failed reconcile and rethrows it, so Cloudflare marks the run as failed', async () => {
  const worker = createWorker(defaultConfig, {
    fetch: async () => new Response('down', { status: 503 }),
    sleep: instantSleep,
  });
  const tasks = [];
  const logged = await collectErrors(async () => {
    await assert.rejects(
      worker.scheduled({}, { ...env, TETHER_SYNC: kv() }, { waitUntil: (task) => tasks.push(task) }),
    );
    await assert.rejects(worker.scheduled({}, env, { waitUntil: (task) => tasks.push(task) }), /TETHER_SYNC/);
  });
  assert.equal(tasks.length, 2, 'the run is handed to waitUntil');
  await Promise.allSettled(tasks);
  assert.equal(logged.filter((line) => line.startsWith('reconcile failed:')).length, 2);
});

test('/check: a missing namespace is a warning for the sync and an error once accounts are on', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const worker = createWorker(defaultConfig, { fetch: apis.fetch, sleep: instantSleep });
  const check = async (extra) =>
    (await worker.fetch(new Request('https://w.test/check', { headers: auth }), { ...env, ...extra }, {})).json();

  const sync = await check({});
  assert.equal(sync.kv, false);
  assert.ok(sync.steps.some((step) => step.title === 'KV storage' && step.level === 'warn'));

  const accounts = {
    ACCOUNT_CLIENT_ID: 'client-1',
    ACCOUNT_ORIGINS: 'https://w.test',
    STOREFRONT_TOKEN: 'public-token',
    ACCOUNT_SECRET: 'a-separate-account-secret-xyz',
  };
  const unbound = await check(accounts);
  assert.equal(unbound.ok, false);
  assert.ok(unbound.steps.some((step) => step.level === 'error' && /TETHER_SYNC/.test(step.message)));

  const bound = await check({ ...accounts, TETHER_SYNC: kv() });
  assert.equal(bound.kv, true);
  assert.ok(!bound.steps.some((step) => /TETHER_SYNC/.test(step.message)));
});

test('the Worker and the browser script are released with one version', async (t) => {
  const { readFile } = await import('node:fs/promises');
  const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  const server = await json('../package.json');
  // A deployed copy holds only server/; whatever lies above it is not Tether's repository.
  const root = await json('../../package.json').catch((error) => ({ unreadable: error }));
  if (root.name !== '@occluze/tether') return t.skip('not in the Tether repository');
  assert.equal(server.version, root.version, 'server/package.json and the root package.json');
  const browserVersion = /export const VERSION = '([^']+)'/.exec(
    await readFile(new URL('../../src/index.js', import.meta.url), 'utf8'),
  )?.[1];
  assert.equal(browserVersion, root.version, 'src/index.js and the root package.json');
});
