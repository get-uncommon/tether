// Deploy/first-run path: default config, env overrides, skipMissingFields, guided check, Worker /check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import defaultConfig from './default-config.js';
import { createApp, memoryStore, createWorker } from '../src/index.ts';
import { runCheck, formatCheck } from '../src/check.ts';
import { cleanEnv } from '../src/env.ts';
import { applyEnv, normalizeConfig } from '../src/mapping.ts';
import {
  createMockApis,
  shopifyProduct,
  instantSleep,
  checkStep,
  noWaitUntil,
  baseConfig,
  env,
  urlOf,
  answeredStep,
  asRecord,
  fieldOf,
  jsonOf,
  parseJson,
  recordAt,
  recordsAt,
  stringAt,
} from './mocks.js';
import { isRecord } from '../src/shared/json.ts';

/** @typedef {typeof globalThis.fetch} Fetch */

const COL = '0123456789abcdef01234567';
const deployEnv = {
  SHOPIFY_DOMAIN: 'shop.myshopify.com',
  WEBFLOW_COLLECTION_ID: COL,
  WEBFLOW_TOKEN: 'wf',
  SHOPIFY_CLIENT_ID: 'cid',
  SHOPIFY_CLIENT_SECRET: 'csecret',
  SHOPIFY_ADMIN_TOKEN: 'none',
  SHOPIFY_WEBHOOK_SECRET: 'none',
  SYNC_SECRET: 'a-long-random-sync-secret-123',
  FIELD_MAP: 'none',
};

test('cleanEnv treats none/-/empty as unset; applyEnv merges FIELD_MAP and WEBFLOW_OWNED', () => {
  assert.deepEqual(cleanEnv({ A: 'none', B: ' - ', C: '', D: 'x' }), { D: 'x' });
  const raw = applyEnv(defaultConfig, {
    FIELD_MAP: '{"material":"metafield:custom.material","gallery":null}',
    WEBFLOW_OWNED: 'description, intro',
    SHOPIFY_DOMAIN: 's.myshopify.com',
  });
  assert.ok(raw.fields && raw.shopify);
  assert.equal(raw.fields['material'], 'metafield:custom.material');
  assert.ok(!('gallery' in raw.fields));
  assert.deepEqual(raw.webflowOwned, ['description', 'intro']);
  assert.equal(raw.shopify.domain, 's.myshopify.com');
  assert.deepEqual(normalizeConfig(raw).shopify.metafields, ['custom.material']);
  assert.equal(defaultConfig.fields.name, 'title', 'config file itself is untouched');
  assert.throws(() => applyEnv(defaultConfig, { FIELD_MAP: '{oops' }), /FIELD_MAP is not valid JSON/);
});

test('a metafield reference without a namespace or key is refused where the config is read, naming its entry', async () => {
  assert.throws(() => applyEnv(defaultConfig, { FIELD_MAP: '{"material":"metafield:material"}' }), {
    code: 'FIELD_MAP',
    message: 'FIELD_MAP "material": "material" is not a metafield reference: write namespace.key, e.g. custom.material',
  });
  assert.throws(
    () => normalizeConfig({ fields: { teaser: 'metafield:custom.' } }),
    /^SyncError: fields\.teaser: "custom\."/,
  );
  assert.throws(
    () => normalizeConfig({ shopify: { metafields: ['custom.ok', 'bad key'] } }),
    /^SyncError: shopify\.metafields: "bad key"/,
  );
  assert.deepEqual(normalizeConfig({ shopify: { metafields: ['$app:reviews.rating'] } }).shopify.metafields, [
    '$app:reviews.rating',
  ]);

  const report = await runCheck(
    defaultConfig,
    { ...deployEnv, FIELD_MAP: '{"material":"metafield:.material"}' },
    {
      deep: false,
    },
  );
  const step = checkStep(report, 'Config');
  assert.equal(step.level, 'error');
  assert.match(step.message, /^FIELD_MAP "material": "\.material" is not a metafield reference/);
  assert.equal(step.fix, 'Fix FIELD_MAP, or set it to "none".');
});

test('default config + env (what the Deploy button provides) syncs a standard collection', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const app = createApp(defaultConfig, deployEnv, { store: memoryStore(), fetch: apis.fetch, sleep: instantSleep });
  assert.deepEqual(app.webhookSecrets, ['csecret']);
  const result = await app.sync.importAll();
  assert.equal(result.stats.created, 1);
  const [item] = [...apis.wf.items.values()];
  assert.ok(item);
  // the mock collection has name, slug, shopify-id, price, main-image, description, material
  assert.deepEqual(Object.keys(item.fieldData).sort(), [
    'description',
    'main-image',
    'name',
    'price',
    'shopify-id',
    'slug',
  ]);
  assert.equal(item.fieldData['shopify-id'], '1');
});

test('check without anything set lists every missing piece with a fix, and makes no requests', async () => {
  const apis = createMockApis();
  const report = await runCheck(defaultConfig, { SHOPIFY_ADMIN_TOKEN: 'none' }, { fetch: apis.fetch });
  assert.equal(report.ok, false);
  const errors = report.steps.filter((step) => step.level === 'error').map((step) => step.title);
  assert.deepEqual(errors, ['Shopify store', 'Shopify access', 'Webflow token', 'Webflow collection', 'Connections']);
  assert.ok(
    report.steps.filter((step) => step.level === 'error' && step.title !== 'Connections').every((step) => step.fix),
  );
  assert.equal(apis.calls.length, 0);
  assert.match(formatCheck(report), /fix: Set SHOPIFY_DOMAIN/);
  assert.match(formatCheck(report), /5 thing\(s\) to fix/);
});

test('check catches a custom domain and half-set client credentials', async () => {
  const report = await runCheck(
    defaultConfig,
    { SHOPIFY_DOMAIN: 'shop.example.com', SHOPIFY_CLIENT_ID: 'x' },
    { deep: false },
  );
  assert.match(checkStep(report, 'Shopify store').message, /isn't a \.myshopify\.com domain/);
  assert.match(checkStep(report, 'Shopify access').message, /Only one of/);
});

test('check with everything set tests the APIs, reports mapping problems and a sample', async () => {
  const apis = createMockApis({ products: [shopifyProduct(3)] });
  const report = await runCheck(defaultConfig, deployEnv, { fetch: apis.fetch, sleep: instantSleep });
  assert.equal(report.ok, true, formatCheck(report));
  /** @param {string} title */
  const by = (title) => report.steps.filter((step) => step.title === title);
  assert.match(by('Shopify API')[0]?.message ?? '', /Shop \(API 2026-07\)/);
  assert.match(by('Webflow API')[0]?.message ?? '', /collection "Products"/);
  const skippedLine = by('Field mapping').filter((step) => step.message.includes('not synced'));
  assert.equal(skippedLine.length, 1, 'missing fields folded into one line');
  assert.match(skippedLine[0]?.message ?? '', /gallery/);
  assert.ok(!by('Field mapping').some((step) => step.level === 'warn'), 'no warnings for expected missing fields');
  const sample = by('Sample')[0]?.sample;
  assert.ok(sample);
  assert.equal(sample['slug'], 'product-3');
  assert.ok(!('gallery' in sample));
  assert.ok(!JSON.stringify(report).includes('csecret'), 'no secrets in the report');
});

test('check explains a wrong collection id and a rejected Webflow token', async () => {
  const apis = createMockApis({ products: [shopifyProduct(3)] });
  /**
   * @param {number} status
   * @returns {Fetch}
   */
  const failing = (status) => async (url, init) =>
    urlOf(url).includes('api.webflow.com')
      ? new Response(JSON.stringify({ message: 'nope' }), { status })
      : apis.fetch(url, init);
  let report = await runCheck(defaultConfig, deployEnv, { fetch: failing(404) });
  assert.match(checkStep(report, 'Webflow API').fix ?? '', /check WEBFLOW_COLLECTION_ID/);
  report = await runCheck(defaultConfig, deployEnv, { fetch: failing(401) });
  assert.match(checkStep(report, 'Webflow API').fix ?? '', /rejected/);
  assert.equal(report.ok, false);
});

test('worker GET /check: config presence for anyone, API tests only with SYNC_SECRET', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const worker = createWorker(defaultConfig, { fetch: apis.fetch, sleep: instantSleep });
  const ctx = { waitUntil() {} };
  let res = await worker.fetch(new Request('https://sync.test/check'), deployEnv, ctx);
  const publicBody = asRecord(await jsonOf(res), 'the public report');
  assert.equal(res.status, 200);
  assert.ok(!publicBody['config'], 'no field config without the secret');
  const publicSteps = recordsAt(publicBody, 'steps');
  assert.ok(
    publicSteps.every((step) => !('message' in step) && !('fix' in step)),
    'only titles and levels for the public: messages name the store and the site',
  );
  assert.ok(!publicSteps.some((step) => step['title'] === 'Shopify API'));
  assert.equal(apis.calls.length, 0);

  res = await worker.fetch(
    new Request('https://sync.test/check', { headers: { authorization: 'Bearer a-long-random-sync-secret-123' } }),
    deployEnv,
    ctx,
  );
  const body = await jsonOf(res);
  assert.ok(recordsAt(body, 'steps').some((step) => step['title'] === 'Shopify API' && step['level'] === 'ok'));
  assert.ok(recordAt(recordAt(body, 'config'), 'fields')['name']);

  res = await worker.fetch(new Request('https://sync.test/check'), {}, ctx);
  assert.equal(res.status, 503);
});

test('example values and a short SYNC_SECRET count as not set, and check names them', async () => {
  const { cleanEnv: clean } = await import('../src/env.ts');
  const filled = {
    SHOPIFY_DOMAIN: 'your-store.myshopify.com',
    WEBFLOW_TOKEN: 'your-webflow-site-token',
    WEBFLOW_COLLECTION_ID: '0123456789abcdef01234567',
    SHOPIFY_ADMIN_TOKEN: 'shpat_…',
    SYNC_SECRET: 'short',
    SHOPIFY_CLIENT_SECRET: 'choose-a-long-random-string',
  };
  assert.deepEqual(Object.keys(clean(filled)), ['WEBFLOW_COLLECTION_ID']);
  const report = await runCheck(defaultConfig, filled, { deep: false, worker: true });
  /** @param {string} title */
  const message = (title) => report.steps.find((step) => step.title === title)?.message || '';
  assert.match(message('SHOPIFY_DOMAIN'), /example value/);
  assert.match(message('WEBFLOW_TOKEN'), /example value/);
  assert.match(message('SHOPIFY_ADMIN_TOKEN'), /example value/);
  assert.match(message('SYNC_SECRET'), /shorter than 24/);
  assert.equal(report.ok, false);
});

test('only an exact example value is a placeholder: real values that resemble one are kept', async () => {
  const { cleanEnv: clean } = await import('../src/env.ts');
  const real = {
    WEBFLOW_OWNED: 'todo-notes,description',
    FIELD_MAP: '{"name":"title","teaser":"metafield:custom.teaser..."}',
    SHOPIFY_DOMAIN: 'example-shop.myshopify.com',
    SYNC_SECRET: 'your-own-long-random-sync-secret',
  };
  assert.deepEqual(clean(real), real);
  assert.deepEqual(clean({ SHOPIFY_DOMAIN: 'your-store.myshopify.com', SHOPIFY_CLIENT_ID: 'your-app-client-id' }), {});
});

test('worker: placeholder SYNC_SECRET never unlocks /reconcile or the deep check', async () => {
  const apis = createMockApis();
  const worker = createWorker(defaultConfig, { fetch: apis.fetch, sleep: instantSleep });
  const wenv = { ...deployEnv, SYNC_SECRET: 'choose-a-long-random-string' };
  const reconcile = await worker.fetch(
    new Request('https://w.test/reconcile', {
      method: 'POST',
      headers: { authorization: 'Bearer choose-a-long-random-string' },
    }),
    wenv,
    noWaitUntil,
  );
  assert.equal(reconcile.status, 401);
  const check = await jsonOf(
    await worker.fetch(
      new Request('https://w.test/check', { headers: { authorization: 'Bearer choose-a-long-random-string' } }),
      wenv,
      noWaitUntil,
    ),
  );
  assert.ok(!recordsAt(check, 'steps').some((step) => step['title'] === 'Shopify API'));
  assert.equal(apis.calls.length, 0);
});

test('.dev.vars.example: only the six fields a deploy needs, all empty and described', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../.dev.vars.example', import.meta.url), 'utf8');
  const lines = text.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
  assert.deepEqual(
    lines.map((line) => line.slice(0, -1)),
    [
      'SHOPIFY_DOMAIN',
      'WEBFLOW_COLLECTION_ID',
      'WEBFLOW_TOKEN',
      'SHOPIFY_CLIENT_ID',
      'SHOPIFY_CLIENT_SECRET',
      'SYNC_SECRET',
    ],
  );
  lines.forEach((line) => {
    assert.match(line, /^[A-Z_]+=$/, line);
  });
  const pkg = parseJson(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const bindings = recordAt(recordAt(pkg, 'cloudflare'), 'bindings');
  lines.forEach((line) => {
    const binding = bindings[line.slice(0, -1)];
    assert.ok(isRecord(binding) && binding['description'], `description for ${line}`);
  });
});

test('webhooks: POST /reconcile registers them through the app, and again after Shopify removed them; check reports them', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  /** @type {Map<string, string>} */
  const entries = new Map();
  /** @type {import('../src/env.ts').KvBinding} */
  const TETHER_SYNC = {
    async get(key, type) {
      const value = entries.get(key);
      if (value == null) return null;
      return type === 'json' ? parseJson(value) : value;
    },
    async put(key, value) {
      entries.set(key, value);
    },
    async delete(key) {
      entries.delete(key);
    },
  };
  const worker = createWorker(defaultConfig, { fetch: apis.fetch, sleep: instantSleep });
  const wenv = { ...deployEnv, TETHER_SYNC };
  const auth = { authorization: `Bearer ${deployEnv.SYNC_SECRET}` };

  let check = await jsonOf(
    await worker.fetch(new Request('https://w.test/check', { headers: auth }), wenv, noWaitUntil),
  );
  assert.match(stringAt(answeredStep(check, 'Shopify webhooks'), 'message'), /not registered: PRODUCTS_CREATE/);

  const reconciled = await jsonOf(
    await worker.fetch(
      new Request('https://w.test/reconcile?since=all', { method: 'POST', headers: auth }),
      wenv,
      noWaitUntil,
    ),
  );
  assert.deepEqual(fieldOf(recordAt(reconciled, 'webhooks'), 'created'), [
    'PRODUCTS_CREATE',
    'PRODUCTS_UPDATE',
    'PRODUCTS_DELETE',
  ]);
  assert.ok(apis.shop.webhooks.every((webhook) => webhook.uri === 'https://w.test/webhooks/shopify'));
  const again = await jsonOf(
    await worker.fetch(new Request('https://w.test/reconcile', { method: 'POST', headers: auth }), wenv, noWaitUntil),
  );
  assert.deepEqual(fieldOf(recordAt(again, 'webhooks'), 'created'), []);
  assert.equal(apis.shop.webhooks.length, 3, 'no duplicates');

  check = await jsonOf(await worker.fetch(new Request('https://w.test/check', { headers: auth }), wenv, noWaitUntil));
  assert.equal(fieldOf(answeredStep(check, 'Shopify webhooks'), 'level'), 'ok');

  // Shopify deletes a subscription whose deliveries keep failing.
  apis.shop.webhooks.splice(1, 1);
  check = await jsonOf(await worker.fetch(new Request('https://w.test/check', { headers: auth }), wenv, noWaitUntil));
  const removed = answeredStep(check, 'Shopify webhooks');
  assert.match(stringAt(removed, 'message'), /not registered: PRODUCTS_UPDATE/);
  assert.match(stringAt(removed, 'fix'), /POST \/reconcile/);
  const recovered = await jsonOf(
    await worker.fetch(new Request('https://w.test/reconcile', { method: 'POST', headers: auth }), wenv, noWaitUntil),
  );
  assert.deepEqual(fieldOf(recordAt(recovered, 'webhooks'), 'created'), ['PRODUCTS_UPDATE']);
  check = await jsonOf(await worker.fetch(new Request('https://w.test/check', { headers: auth }), wenv, noWaitUntil));
  assert.equal(fieldOf(answeredStep(check, 'Shopify webhooks'), 'level'), 'ok');
});

test('webhooks signed with either the client secret or SHOPIFY_WEBHOOK_SECRET are accepted', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const worker = createWorker(defaultConfig, { fetch: apis.fetch, sleep: instantSleep });
  const { signShopify } = await import('../src/hmac.ts');
  /** @param {string} key */
  const send = async (key) => {
    const body = JSON.stringify({ id: 1 });
    return worker.fetch(
      new Request('https://w.test/webhooks/shopify', {
        method: 'POST',
        body,
        headers: {
          'x-shopify-topic': 'products/update',
          'x-shopify-hmac-sha256': await signShopify(body, key),
          'x-shopify-shop-domain': 'shop.myshopify.com',
        },
      }),
      { ...deployEnv, SHOPIFY_WEBHOOK_SECRET: 'admin-key' },
      { waitUntil() {} },
    );
  };
  assert.equal((await send('csecret')).status, 200);
  assert.equal((await send('admin-key')).status, 200);
  assert.equal((await send('wrong')).status, 401);
});

test('the shipped config equals the test copy (skipped in a deployed, customizable copy)', async (context) => {
  const repo = process.env['GITHUB_REPOSITORY'];
  if (repo && repo !== 'ravi-klaassens/tether') {
    context.skip('deployed copy: its config may be customized');
    return;
  }
  const shipped = (await import('../tether-sync.config.js')).default;
  assert.deepEqual(shipped, defaultConfig);
});

test('check says when a newer release in the range exists (a stalled updater shows up)', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  /**
   * @param {string[]} names
   * @returns {Fetch}
   */
  const tags = (names) => async (url, init) =>
    urlOf(url).startsWith('https://data.jsdelivr.com/')
      ? new Response(JSON.stringify({ versions: names.map((name) => ({ version: name.replace(/^v/, '') })) }), {
          status: 200,
        })
      : apis.fetch(url, init);
  let report = await runCheck(defaultConfig, deployEnv, {
    fetch: tags(['v0.3.3', 'v0.3.9', 'v0.4.0']),
    version: '0.3.3',
    sleep: instantSleep,
  });
  const version = checkStep(report, 'Tether version');
  assert.equal(version.level, 'warn');
  assert.match(version.message, /0\.3\.9 is available \(range 0\.3\)/);
  report = await runCheck(defaultConfig, deployEnv, {
    fetch: tags(['v0.3.3', 'v0.4.0']),
    version: '0.3.3',
    sleep: instantSleep,
  });
  assert.equal(checkStep(report, 'Tether version').level, 'ok');
  report = await runCheck(defaultConfig, deployEnv, {
    fetch: tags(['v0.3.3', 'v0.4.0']),
    version: '0.3.3',
    range: 'latest',
    sleep: instantSleep,
  });
  assert.match(checkStep(report, 'Tether version').message, /0\.4\.0 is available/);
});

test('check refuses a TETHER_VERSION the updater would refuse, and picks releases by the same rules', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  /** @type {Fetch} */
  const fetch = async (url, init) =>
    urlOf(url).startsWith('https://data.jsdelivr.com/')
      ? new Response(JSON.stringify({ versions: [{ version: '0.3.3' }, { version: '0.3.10' }] }), { status: 200 })
      : apis.fetch(url, init);
  const options = { fetch, version: '0.3.3', sleep: instantSleep };
  let report = await runCheck(defaultConfig, deployEnv, { ...options, range: '^0.3' });
  const refused = checkStep(report, 'Tether version');
  assert.equal(refused.level, 'warn');
  assert.match(refused.message, /TETHER_VERSION must be/);
  report = await runCheck(defaultConfig, deployEnv, { ...options, range: '*' });
  assert.match(checkStep(report, 'Tether version').message, /0\.3\.10 is available/);
});

test('SYNC_SECRET "none" does not open /reconcile; /check without it hides values', async () => {
  const apis = createMockApis();
  const worker = createWorker(baseConfig, { fetch: apis.fetch, sleep: instantSleep });
  const wenv = { ...env, SYNC_SECRET: 'none', SHOPIFY_DOMAIN: 'secret-shop.myshopify.com' };
  const reconcile = await worker.fetch(
    new Request('https://w.test/reconcile', { method: 'POST', headers: { authorization: 'Bearer none' } }),
    wenv,
    noWaitUntil,
  );
  assert.equal(reconcile.status, 401);
  const check = await (await worker.fetch(new Request('https://w.test/check'), wenv, noWaitUntil)).text();
  assert.ok(!check.includes('secret-shop'));
});
