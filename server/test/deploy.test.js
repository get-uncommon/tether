// Rebuild-on-change: DEPLOY_HOOK_URL, with and without Webflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import defaultConfig from '../tether-sync.config.js';
import { createApp, memoryStore } from '../src/index.js';
import { runCheck } from '../src/check.js';
import { createMockApis, shopifyProduct, baseConfig, instantSleep } from './mocks.js';

const HOOK = 'https://api.pages.test/deploy_hooks/abc';
const shopEnv = { SHOPIFY_DOMAIN: 'shop.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'shpat_x', DEPLOY_HOOK_URL: HOOK };

function setup({
  products = [shopifyProduct(1), shopifyProduct(2)],
  env = shopEnv,
  config = defaultConfig,
  hookStatus = 200,
} = {}) {
  const apis = createMockApis({ products });
  const hooks = [];
  let clock = Date.parse('2026-11-04T12:00:00Z');
  const fetch = async (url, init) => {
    if (String(url) === HOOK) {
      hooks.push(clock);
      return new Response('{}', { status: hookStatus });
    }
    return apis.fetch(url, init);
  };
  const store = memoryStore();
  const make = () => createApp(config, env, { store, fetch, sleep: instantSleep });
  return {
    apis,
    hooks,
    store,
    make,
    tick: (s) => {
      clock += s * 1000;
    },
    now: () => clock,
  };
}

test('deploy-only: the first import starts one build; running it again starts none', async () => {
  const t = setup();
  const app = t.make();
  assert.equal(app.deployOnly, true);
  const r = await app.sync.importAll();
  assert.equal(r.stats.created, 2);
  assert.equal(t.hooks.length, 1);
  assert.equal(r.deploy.triggered, true);
  const again = await t.make().sync.importAll();
  assert.equal(again.stats.unchanged, 2);
  assert.equal(t.hooks.length, 1, 'nothing changed, no build');
  assert.equal(t.apis.webflowWrites().length, 0, 'no Webflow calls at all');
});

test('deploy-only: a content change starts a build, a stock-only change does not', async () => {
  const t = setup();
  await t.make().sync.importAll();
  const before = t.hooks.length;
  // Stock changes (availability, inventory) are live on the page through Tether: no rebuild.
  const p1 = shopifyProduct(1);
  p1.variants.nodes[0].availableForSale = false;
  t.apis.shop.products.set(p1.id, p1);
  const r1 = await t.make().sync.syncById(1);
  assert.equal(r1.action, 'unchanged');
  assert.equal(t.hooks.length, before);
  // A new title is content: rebuild.
  t.apis.shop.products.set(p1.id, { ...p1, title: 'New name' });
  await new Promise((r) => setTimeout(r, 5));
  const app = createApp(
    defaultConfig,
    { ...shopEnv, DEPLOY_HOOK_MIN_SECONDS: '0' },
    {
      store: t.store,
      fetch: async (u, i) => (String(u) === HOOK ? (t.hooks.push(Date.now()), new Response('{}')) : t.apis.fetch(u, i)),
      sleep: instantSleep,
    },
  );
  const r2 = await app.sync.syncById(1);
  assert.equal(r2.action, 'updated');
  assert.equal(r2.deploy.triggered, true);
  assert.equal(t.hooks.length, before + 1);
});

test('deploy-only: changes within the interval wait for the next run, then give one build', async () => {
  const t = setup();
  const realNow = Date.now;
  Date.now = t.now;
  try {
    await t.make().sync.importAll();
    assert.equal(t.hooks.length, 1);
    t.tick(10);
    t.apis.shop.products.set('gid://shopify/Product/1', shopifyProduct(1, { title: 'A' }));
    const r1 = await t.make().sync.syncById(1);
    assert.equal(r1.deploy.pending, true, 'noted, not built yet (60s interval)');
    t.apis.shop.products.set('gid://shopify/Product/2', shopifyProduct(2, { title: 'B' }));
    await t.make().sync.syncById(2);
    assert.equal(t.hooks.length, 1);
    t.tick(60);
    const r3 = await t.make().sync.reconcile(); // the cron run
    assert.equal(r3.deploy.triggered, true);
    assert.equal(t.hooks.length, 2, 'two changes, one build');
  } finally {
    Date.now = realNow;
  }
});

test('deploy-only: a failing hook is retried on the next run', async () => {
  const t = setup({ hookStatus: 500 });
  const r = await t.make().sync.importAll();
  assert.match(r.deploy.error, /answered 500/);
  assert.deepEqual(await t.store.get('deploy:state'), { dirty: true, lastAt: 0 });
});

test('deploy-only from the Deploy button: Webflow fields filled with "none" count as unset', async () => {
  const t = setup({ env: { ...shopEnv, WEBFLOW_TOKEN: 'none', WEBFLOW_COLLECTION_ID: 'none' } });
  const app = t.make();
  assert.equal(app.deployOnly, true);
  await app.sync.importAll();
  assert.equal(t.hooks.length, 1);
});

test('Webflow + deploy hook: Webflow is written and a build starts', async () => {
  const t = setup({
    config: baseConfig,
    env: { ...shopEnv, WEBFLOW_TOKEN: 'wf', SHOPIFY_DOMAIN: 'shop.myshopify.com' },
  });
  const app = t.make();
  assert.equal(app.deployOnly, false);
  await app.sync.importAll();
  assert.equal(t.apis.wf.items.size, 2);
  assert.equal(t.hooks.length, 1);
  assert.ok(app.webflow.requests > 0, 'the request count follows the Webflow client');
});

test('check in deploy-only mode: no Webflow errors, the hook is validated', async () => {
  const ok = await runCheck(defaultConfig, shopEnv, { deep: false });
  assert.ok(!ok.steps.some((s) => /Webflow/.test(s.title)), ok.steps.map((s) => s.title).join(','));
  assert.match(ok.steps.find((s) => s.title === 'Deploy hook').message, /no Webflow/);
  assert.equal(ok.ok, true);
  const bad = await runCheck(defaultConfig, { ...shopEnv, DEPLOY_HOOK_URL: 'http://insecure.test' }, { deep: false });
  assert.match(bad.steps.find((s) => s.title === 'Deploy hook').message, /must be an https URL/);
});

test('deploy hook: a network error keeps the build pending for the next run', async () => {
  const { createDeployHook } = await import('../src/deploy.js');
  const store = memoryStore();
  let calls = 0;
  const fetch = async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return new Response('{}', { status: 200 });
  };
  const hook = createDeployHook({ url: HOOK, store, fetch, now: () => 1e12 });
  hook.markDirty();
  await assert.rejects(hook.maybeTrigger(), /offline/);
  assert.deepEqual(await hook.maybeTrigger(), { triggered: true }, 'no new change needed: the failed build is retried');
  assert.equal(calls, 2);
});
