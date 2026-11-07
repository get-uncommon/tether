// The Worker around the sync: its KV namespace, the cron's failures, and what /check says about both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import defaultConfig from './default-config.js';
import { createWorker } from '../src/index.ts';
import { signShopify } from '../src/hmac.ts';
import {
  createMockApis,
  shopifyProduct,
  instantSleep,
  noWaitUntil,
  urlOf,
  asString,
  fieldOf,
  jsonOf,
  parseJson,
  recordsAt,
  stringAt,
} from './mocks.js';

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
 * The `/check` answer the Worker sends with the bearer secret, read from its JSON.
 *
 * @param {unknown} answer
 */
function checkAnswerOf(answer) {
  return {
    ok: fieldOf(answer, 'ok'),
    kv: fieldOf(answer, 'kv'),
    steps: recordsAt(answer, 'steps').map((step) => ({
      level: stringAt(step, 'level'),
      title: stringAt(step, 'title'),
      message: stringAt(step, 'message'),
      fix: step['fix'] === undefined ? undefined : asString(step['fix'], 'fix'),
    })),
  };
}

/**
 * A KV namespace in memory.
 *
 * @returns {import('../src/env.ts').KvBinding & { map: Map<string, string> }}
 */
function kv() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    map,
    get: async (key, type) => {
      const value = map.get(key);
      if (value === undefined) return null;
      return type === 'json' ? parseJson(value) : value;
    },
    put: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
  };
}

/**
 * Runs `body` with console.error collected instead of printed.
 *
 * @param {() => Promise<void>} body
 */
async function collectErrors(body) {
  /** @type {string[]} */
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
  assert.match(stringAt(await jsonOf(response), 'error'), /TETHER_SYNC/);
  assert.ok(logged.some((line) => line.includes('reconcile: the TETHER_SYNC KV namespace is not bound')));
  assert.equal(apis.calls.length, 0, 'nothing is synced into a store that forgets it');
});

test('the cron logs a failed reconcile and rethrows it, so Cloudflare marks the run as failed', async () => {
  const worker = createWorker(defaultConfig, {
    fetch: async () => new Response('down', { status: 503 }),
    sleep: instantSleep,
  });
  /** @type {Promise<unknown>[]} */
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
  /** @param {Record<string, unknown>} extra */
  const check = async (extra) =>
    checkAnswerOf(
      await jsonOf(
        await worker.fetch(new Request('https://w.test/check', { headers: auth }), { ...env, ...extra }, noWaitUntil),
      ),
    );

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
  assert.ok(unbound.steps.some((step) => step.level === 'error' && step.message.includes('TETHER_SYNC')));

  const bound = await check({ ...accounts, TETHER_SYNC: kv() });
  assert.equal(bound.kv, true);
  assert.ok(!bound.steps.some((step) => step.message.includes('TETHER_SYNC')));

  const noSecret = await check({ ...accounts, ACCOUNT_SECRET: undefined, TETHER_SYNC: kv() });
  assert.equal(noSecret.ok, false);
  const secretStep = noSecret.steps.find((step) => step.level === 'error' && step.message.includes('ACCOUNT_SECRET'));
  assert.match(secretStep?.fix ?? '', /Add the Worker secret ACCOUNT_SECRET, a random string of at least 24/);

  const sharedSecret = await check({ ...accounts, ACCOUNT_SECRET: SECRET, TETHER_SYNC: kv() });
  assert.equal(sharedSecret.ok, false);
  assert.ok(
    sharedSecret.steps.some(
      (step) => step.level === 'error' && step.message.includes('ACCOUNT_SECRET is the same as SYNC_SECRET'),
    ),
  );
});

test('with customer accounts but no ACCOUNT_SECRET only the account routes stop; sync, webhooks and deploys run', async () => {
  const hook = 'https://api.pages.test/deploy_hooks/abc';
  const apis = createMockApis({ products: [shopifyProduct(1), shopifyProduct(2)] });
  /** @type {(RequestInfo | URL)[]} */
  const deploys = [];
  /** @type {typeof globalThis.fetch} */
  const fetchWithHook = async (url, init) => {
    if (urlOf(url) === hook) {
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
  /** @type {Promise<unknown>[]} */
  const tasks = [];
  const context = { waitUntil: (/** @type {Promise<unknown>} */ task) => tasks.push(task) };
  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  const send = (path, init) => worker.fetch(new Request(`https://w.test${path}`, init), accountsWithoutSecret, context);

  const logged = await collectErrors(async () => {
    const login = await send('/_tether/account/login', { headers: { origin: 'https://w.test' } });
    assert.equal(login.status, 503);
    assert.match(stringAt(await jsonOf(login), 'error'), /accounts need the Worker secret ACCOUNT_SECRET/);
  });
  assert.ok(logged.some((line) => line.includes('account setup ACCOUNT_SECRET is not set')));

  const report = checkAnswerOf(await jsonOf(await send('/check', { headers: auth })));
  const errors = report.steps.filter((step) => step.level === 'error');
  assert.deepEqual(
    errors.map((step) => step.title),
    ['Customer accounts'],
  );
  assert.match(errors[0]?.message ?? '', /ACCOUNT_SECRET is not set/);

  const imported = await send('/reconcile?since=all', { method: 'POST', headers: auth });
  assert.equal(imported.status, 200);
  assert.equal(fieldOf(await jsonOf(imported), 'processed'), 2);
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

test('the Worker and the browser script are released with one version', async (context) => {
  const { readFile } = await import('node:fs/promises');
  /** @param {string} path */
  const json = async (path) => parseJson(await readFile(new URL(path, import.meta.url), 'utf8'));
  const server = await json('../package.json');
  // A deployed copy holds only server/; whatever lies above it is not Tether's repository.
  const rootPackage = new URL('../../package.json', import.meta.url);
  const root = existsSync(rootPackage) ? await json(rootPackage.href) : null;
  if (root === null || fieldOf(root, 'name') !== '@occluze/tether') {
    context.skip('not in the Tether repository');
    return;
  }
  const rootVersion = fieldOf(root, 'version');
  assert.equal(fieldOf(server, 'version'), rootVersion, 'server/package.json and the root package.json');
  const browserVersion = /export const VERSION = '([^']+)'/.exec(
    await readFile(new URL('../../src/version.ts', import.meta.url), 'utf8'),
  )?.[1];
  assert.equal(browserVersion, rootVersion, 'src/version.ts and the root package.json');
});
