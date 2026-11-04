// Deploy/first-run path: default config, env overrides, skipMissingFields, guided check, Worker /check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import defaultConfig from '../tether-sync.config.js';
import { createApp, memoryStore, createWorker } from '../src/index.js';
import { runCheck, formatCheck } from '../src/check.js';
import { cleanEnv, applyEnv, normalizeConfig } from '../src/mapping.js';
import { createMockApis, shopifyProduct, instantSleep } from './mocks.js';

const COL = '0123456789abcdef01234567';
const deployEnv = {
  SHOPIFY_DOMAIN: 'shop.myshopify.com', WEBFLOW_COLLECTION_ID: COL, WEBFLOW_TOKEN: 'wf',
  SHOPIFY_CLIENT_ID: 'cid', SHOPIFY_CLIENT_SECRET: 'csecret',
  SHOPIFY_ADMIN_TOKEN: 'none', SHOPIFY_WEBHOOK_SECRET: 'none', SYNC_SECRET: 'a-long-random-sync-secret-123', FIELD_MAP: 'none',
};

test('cleanEnv treats none/-/empty as unset; applyEnv merges FIELD_MAP and WEBFLOW_OWNED', () => {
  assert.deepEqual(cleanEnv({ A: 'none', B: ' - ', C: '', D: 'x' }), { D: 'x' });
  const raw = applyEnv(defaultConfig, { FIELD_MAP: '{"material":"metafield:custom.material","gallery":null}', WEBFLOW_OWNED: 'description, intro', SHOPIFY_DOMAIN: 's.myshopify.com' });
  assert.equal(raw.fields.material, 'metafield:custom.material');
  assert.ok(!('gallery' in raw.fields));
  assert.deepEqual(raw.webflowOwned, ['description', 'intro']);
  assert.equal(raw.shopify.domain, 's.myshopify.com');
  assert.deepEqual(normalizeConfig(raw).shopify.metafields, ['custom.material']);
  assert.equal(defaultConfig.fields.name, 'title', 'config file itself is untouched');
  assert.throws(() => applyEnv(defaultConfig, { FIELD_MAP: '{oops' }), /FIELD_MAP is not valid JSON/);
});

test('default config + env (what the Deploy button provides) syncs a standard collection', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const app = createApp(defaultConfig, deployEnv, { store: memoryStore(), fetch: apis.fetch, sleep: instantSleep });
  assert.equal(app.webhookSecret, 'csecret');
  const r = await app.sync.importAll();
  assert.equal(r.stats.created, 1);
  const item = [...apis.wf.items.values()][0];
  // the mock collection has name, slug, shopify-id, price, main-image, description, material
  assert.deepEqual(Object.keys(item.fieldData).sort(), ['description', 'main-image', 'name', 'price', 'shopify-id', 'slug']);
  assert.equal(item.fieldData['shopify-id'], '1');
});

test('check without anything set lists every missing piece with a fix, and makes no requests', async () => {
  const apis = createMockApis();
  const r = await runCheck(defaultConfig, { SHOPIFY_ADMIN_TOKEN: 'none' }, { fetch: apis.fetch });
  assert.equal(r.ok, false);
  const errs = r.steps.filter((s) => s.level === 'error').map((s) => s.title);
  assert.deepEqual(errs, ['Shopify store', 'Shopify access', 'Webflow token', 'Webflow collection', 'Connections']);
  assert.ok(r.steps.filter((s) => s.level === 'error' && s.title !== 'Connections').every((s) => s.fix));
  assert.equal(apis.calls.length, 0);
  assert.match(formatCheck(r), /fix: Set SHOPIFY_DOMAIN/);
  assert.match(formatCheck(r), /5 thing\(s\) to fix/);
});

test('check catches a custom domain and half-set client credentials', async () => {
  const r = await runCheck(defaultConfig, { SHOPIFY_DOMAIN: 'shop.example.com', SHOPIFY_CLIENT_ID: 'x' }, { deep: false });
  assert.match(r.steps.find((s) => s.title === 'Shopify store').message, /isn't a \.myshopify\.com domain/);
  assert.match(r.steps.find((s) => s.title === 'Shopify access').message, /Only one of/);
});

test('check with everything set tests the APIs, reports mapping problems and a sample', async () => {
  const apis = createMockApis({ products: [shopifyProduct(3)] });
  const r = await runCheck(defaultConfig, deployEnv, { fetch: apis.fetch, sleep: instantSleep });
  assert.equal(r.ok, true, formatCheck(r));
  const by = (t) => r.steps.filter((s) => s.title === t);
  assert.match(by('Shopify API')[0].message, /Shop \(API 2026-07\)/);
  assert.match(by('Webflow API')[0].message, /collection "Products"/);
  assert.ok(by('Field mapping').some((s) => s.level === 'warn' && /"gallery" doesn't exist/.test(s.message)));
  assert.equal(by('Sample')[0].sample.slug, 'product-3');
  assert.ok(!('gallery' in by('Sample')[0].sample));
  assert.ok(!JSON.stringify(r).includes('csecret'), 'no secrets in the report');
});

test('check explains a wrong collection id and a rejected Webflow token', async () => {
  const apis = createMockApis({ products: [shopifyProduct(3)] });
  const failing = (status) => async (url, init) => (String(url).includes('api.webflow.com')
    ? new Response(JSON.stringify({ message: 'nope' }), { status }) : apis.fetch(url, init));
  let r = await runCheck(defaultConfig, deployEnv, { fetch: failing(404) });
  assert.match(r.steps.find((s) => s.title === 'Webflow API').fix, /check WEBFLOW_COLLECTION_ID/);
  r = await runCheck(defaultConfig, deployEnv, { fetch: failing(401) });
  assert.match(r.steps.find((s) => s.title === 'Webflow API').fix, /rejected/);
  assert.equal(r.ok, false);
});

test('worker GET /check: config presence for anyone, API tests only with SYNC_SECRET', async () => {
  const apis = createMockApis({ products: [shopifyProduct(1)] });
  const worker = createWorker(defaultConfig, { fetch: apis.fetch, sleep: instantSleep });
  const ctx = { waitUntil() {} };
  let res = await worker.fetch(new Request('https://sync.test/check'), deployEnv, ctx);
  let body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(!body.config, 'no field config without the secret');
  assert.ok(!body.steps.some((s) => s.title === 'Shopify API'));
  assert.equal(apis.calls.length, 0);

  res = await worker.fetch(new Request('https://sync.test/check', { headers: { authorization: 'Bearer a-long-random-sync-secret-123' } }), deployEnv, ctx);
  body = await res.json();
  assert.ok(body.steps.some((s) => s.title === 'Shopify API' && s.level === 'ok'));
  assert.ok(body.config.fields.name);

  res = await worker.fetch(new Request('https://sync.test/check'), {}, ctx);
  assert.equal(res.status, 503);
});

test('example values and a short SYNC_SECRET count as not set, and check names them', async () => {
  const { cleanEnv: clean } = await import('../src/mapping.js');
  const filled = {
    SHOPIFY_DOMAIN: 'your-store.myshopify.com', WEBFLOW_TOKEN: 'your-webflow-site-token',
    WEBFLOW_COLLECTION_ID: '0123456789abcdef01234567', SHOPIFY_ADMIN_TOKEN: 'shpat_…', SYNC_SECRET: 'short',
    SHOPIFY_CLIENT_SECRET: 'choose-a-long-random-string',
  };
  assert.deepEqual(Object.keys(clean(filled)), ['WEBFLOW_COLLECTION_ID']);
  const r = await runCheck(defaultConfig, filled, { deep: false, worker: true });
  const msg = (k) => r.steps.find((s) => s.title === k)?.message || '';
  assert.match(msg('SHOPIFY_DOMAIN'), /example value/);
  assert.match(msg('WEBFLOW_TOKEN'), /example value/);
  assert.match(msg('SHOPIFY_ADMIN_TOKEN'), /example value/);
  assert.match(msg('SYNC_SECRET'), /shorter than 24/);
  assert.equal(r.ok, false);
});

test('worker: placeholder SYNC_SECRET never unlocks /reconcile or the deep check', async () => {
  const apis = createMockApis();
  const worker = createWorker(defaultConfig, { fetch: apis.fetch, sleep: instantSleep });
  const wenv = { ...deployEnv, SYNC_SECRET: 'choose-a-long-random-string' };
  const r = await worker.fetch(new Request('https://w.test/reconcile', { method: 'POST', headers: { authorization: 'Bearer choose-a-long-random-string' } }), wenv, {});
  assert.equal(r.status, 401);
  const c = await (await worker.fetch(new Request('https://w.test/check', { headers: { authorization: 'Bearer choose-a-long-random-string' } }), wenv, {})).json();
  assert.ok(!c.steps.some((s) => s.title === 'Shopify API'));
  assert.equal(apis.calls.length, 0);
});

test('.dev.vars.example has no values, so the deploy form starts empty', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../.dev.vars.example', import.meta.url), 'utf8');
  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  assert.ok(lines.length >= 9);
  lines.forEach((l) => assert.match(l, /^[A-Z_]+=$/, l));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  lines.forEach((l) => assert.ok(pkg.cloudflare.bindings[l.slice(0, -1)]?.description, `description for ${l}`));
});
