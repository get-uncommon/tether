// The Worker around the sync: its KV namespace, the cron's failures, and what /check says about both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import defaultConfig from './default-config.js';
import { createWorker } from '../src/index.ts';
import { signShopify } from '../src/hmac.ts';
import { createMockApis, shopifyProduct, instantSleep, noWaitUntil } from './mocks.js';

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

/**
 * A KV namespace in memory.
 *
 * @returns {import('../src/env.ts').KvBinding & { map: Map<string, string> }}
 */
function kv() {
  const map = new Map();
  return {
    map,
    get: async (key, type) => {
      const value = map.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
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
  /** @type {Response | undefined} */
  let response;
  const logged = await collectErrors(async () => {
    response = await worker.fetch(
      new Request('https://w.test/reconcile', { method: 'POST', headers: auth }),
      env,
      noWaitUntil,
    );
  });
  assert.ok(response);
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
    (
      await worker.fetch(new Request('https://w.test/check', { headers: auth }), { ...env, ...extra }, noWaitUntil)
    ).json();

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

  const noSecret = await check({ ...accounts, ACCOUNT_SECRET: undefined, TETHER_SYNC: kv() });
  assert.equal(noSecret.ok, false);
  const secretStep = noSecret.steps.find((step) => step.level === 'error' && /ACCOUNT_SECRET/.test(step.message));
  assert.match(secretStep?.fix ?? '', /Add the Worker secret ACCOUNT_SECRET, a random string of at least 24/);
});

test('with customer accounts but no ACCOUNT_SECRET only the account routes stop; sync, webhooks and deploys run', async () => {
  const hook = 'https://api.pages.test/deploy_hooks/abc';
  const apis = createMockApis({ products: [shopifyProduct(1), shopifyProduct(2)] });
  const deploys = [];
  /** @type {typeof globalThis.fetch} */
  const fetchWithHook = async (url, init) => {
    if (String(url) === hook) {
      deploys.push(url);
      return new Response('{}');
    }
    return apis.fetch(url, init);
  };
  const worker = createWorker(defaultConfig, { fetch: fetchWithHook, sleep: instantSleep });
  const accountsWithoutSecret = {
    ...env,
    ACCOUNT_CLIENT_ID: 'client-1',
    ACCOUNT_ORIGINS: 'https://w.test',
    STOREFRONT_TOKEN: 'public-token',
    DEPLOY_HOOK_URL: hook,
    DEPLOY_HOOK_MIN_SECONDS: '0',
    TETHER_SYNC: kv(),
  };
  const tasks = [];
  const context = { waitUntil: (task) => tasks.push(task) };
  const send = (path, init) => worker.fetch(new Request(`https://w.test${path}`, init), accountsWithoutSecret, context);

  const logged = await collectErrors(async () => {
    const login = await send('/_tether/account/login', { headers: { origin: 'https://w.test' } });
    assert.equal(login.status, 503);
    assert.match((await login.json()).error, /accounts need the Worker secret ACCOUNT_SECRET/);
  });
  assert.ok(logged.some((line) => /account setup ACCOUNT_SECRET is not set/.test(line)));

  const report = await (await send('/check', { headers: auth })).json();
  const errors = report.steps.filter((step) => step.level === 'error');
  assert.deepEqual(
    errors.map((step) => step.title),
    ['Customer accounts'],
  );
  assert.match(errors[0].message, /ACCOUNT_SECRET is not set/);

  const imported = await send('/reconcile?since=all', { method: 'POST', headers: auth });
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).processed, 2);
  assert.ok(apis.webflowWrites().length > 0, 'the products reach Webflow');
  assert.equal(deploys.length, 1, 'the deploy hook starts a build');

  apis.shop.products.set(shopifyProduct(1).id, shopifyProduct(1, { title: 'Renamed' }));
  const body = JSON.stringify({ id: 1 });
  const webhook = await send('/webhooks/shopify', {
    method: 'POST',
    body,
    headers: {
      'x-shopify-topic': 'products/update',
      'x-shopify-shop-domain': env.SHOPIFY_DOMAIN,
      'x-shopify-hmac-sha256': await signShopify(body, env.SHOPIFY_CLIENT_SECRET),
    },
  });
  assert.equal(webhook.status, 200);
  await Promise.all(tasks);
  assert.ok(
    apis.webflowWrites().some((call) => JSON.stringify(call.body).includes('Renamed')),
    'the webhook syncs the product',
  );

  const cron = await worker.scheduled({}, accountsWithoutSecret, context);
  assert.equal(cron.stopped, null);
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
    await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8'),
  )?.[1];
  assert.equal(browserVersion, root.version, 'src/index.ts and the root package.json');
});
