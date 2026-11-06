// Rebuild-on-change: DEPLOY_HOOK_URL, with and without Webflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import defaultConfig from './default-config.js';
import { createApp, memoryStore } from '../src/index.ts';
import { runCheck } from '../src/check.ts';
import { createMockApis, shopifyProduct, baseConfig, instantSleep, checkStep } from './mocks.js';

const HOOK = 'https://api.pages.test/deploy_hooks/abc';
const shopEnv = { SHOPIFY_DOMAIN: 'shop.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'shpat_x', DEPLOY_HOOK_URL: HOOK };

/**
 * @param {{ products?: import('./mocks.js').MockProduct[], env?: Record<string, string>,
 *   config?: import('../src/mapping.ts').RawConfig, hookStatus?: number }} [options]
 */
function setup({
  products = [shopifyProduct(1), shopifyProduct(2)],
  env = shopEnv,
  config = defaultConfig,
  hookStatus = 200,
} = {}) {
  const apis = createMockApis({ products });
  /** @type {number[]} */
  const hooks = [];
  let clock = Date.parse('2026-11-04T12:00:00Z');
  /** @type {typeof globalThis.fetch} */
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
    /** @param {number} seconds */
    tick: (seconds) => {
      clock += seconds * 1000;
    },
    now: () => clock,
  };
}

test('deploy-only: the first import starts one build; running it again starts none', async () => {
  const harness = setup();
  const app = harness.make();
  assert.equal(app.deployOnly, true);
  const result = await app.sync.importAll();
  assert.equal(result.stats.created, 2);
  assert.equal(harness.hooks.length, 1);
  assert.deepEqual(result.deploy, { triggered: true });
  const again = await harness.make().sync.importAll();
  assert.equal(again.stats.unchanged, 2);
  assert.equal(harness.hooks.length, 1, 'nothing changed, no build');
  assert.equal(harness.apis.webflowWrites().length, 0, 'no Webflow calls at all');
});

test('deploy-only: a content change starts a build, a stock-only change does not', async () => {
  const harness = setup();
  await harness.make().sync.importAll();
  const before = harness.hooks.length;
  // Stock changes (availability, inventory) are live on the page through Tether: no rebuild.
  const product = shopifyProduct(1);
  const [variant] = product.variants.nodes;
  assert.ok(variant);
  variant.availableForSale = false;
  harness.apis.shop.products.set(product.id, product);
  const stockOnly = await harness.make().sync.syncById(1);
  assert.equal(stockOnly.action, 'unchanged');
  assert.equal(harness.hooks.length, before);
  // A new title is content: rebuild.
  harness.apis.shop.products.set(product.id, { ...product, title: 'New name' });
  const app = createApp(
    defaultConfig,
    { ...shopEnv, DEPLOY_HOOK_MIN_SECONDS: '0' },
    {
      store: harness.store,
      fetch: async (url, init) =>
        String(url) === HOOK ? (harness.hooks.push(Date.now()), new Response('{}')) : harness.apis.fetch(url, init),
      sleep: instantSleep,
    },
  );
  const renamed = await app.sync.syncById(1);
  assert.equal(renamed.action, 'updated');
  assert.deepEqual(renamed.deploy, { triggered: true });
  assert.equal(harness.hooks.length, before + 1);
});

test('deploy-only: changes within the interval wait for the next run, then give one build', async () => {
  const harness = setup();
  const realNow = Date.now;
  Date.now = harness.now;
  try {
    await harness.make().sync.importAll();
    assert.equal(harness.hooks.length, 1);
    harness.tick(10);
    harness.apis.shop.products.set('gid://shopify/Product/1', shopifyProduct(1, { title: 'A' }));
    const first = await harness.make().sync.syncById(1);
    assert.ok(first.deploy && 'pending' in first.deploy, 'noted, not built yet (60s interval)');
    harness.apis.shop.products.set('gid://shopify/Product/2', shopifyProduct(2, { title: 'B' }));
    await harness.make().sync.syncById(2);
    assert.equal(harness.hooks.length, 1);
    harness.tick(60);
    const cron = await harness.make().sync.reconcile(); // the cron run
    assert.deepEqual(cron.deploy, { triggered: true });
    assert.equal(harness.hooks.length, 2, 'two changes, one build');
  } finally {
    Date.now = realNow;
  }
});

test('deploy-only: a failing hook is retried on the next run', async () => {
  const harness = setup({ hookStatus: 500 });
  const result = await harness.make().sync.importAll();
  assert.ok(result.deploy && 'error' in result.deploy);
  assert.match(result.deploy.error, /answered 500/);
  assert.deepEqual(await harness.store.get('deploy:state'), { dirty: true, lastAt: 0 });
});

test('deploy-only from the Deploy button: Webflow fields filled with "none" count as unset', async () => {
  const harness = setup({ env: { ...shopEnv, WEBFLOW_TOKEN: 'none', WEBFLOW_COLLECTION_ID: 'none' } });
  const app = harness.make();
  assert.equal(app.deployOnly, true);
  await app.sync.importAll();
  assert.equal(harness.hooks.length, 1);
});

test('Webflow + deploy hook: Webflow is written and a build starts', async () => {
  const harness = setup({
    config: baseConfig,
    env: { ...shopEnv, WEBFLOW_TOKEN: 'wf', SHOPIFY_DOMAIN: 'shop.myshopify.com' },
  });
  const app = harness.make();
  assert.equal(app.deployOnly, false);
  await app.sync.importAll();
  assert.equal(harness.apis.wf.items.size, 2);
  assert.equal(harness.hooks.length, 1);
  assert.ok(app.webflow.requests > 0, 'the request count follows the Webflow client');
});

test('check in deploy-only mode: no Webflow errors, the hook is validated', async () => {
  const ok = await runCheck(defaultConfig, shopEnv, { deep: false });
  assert.ok(!ok.steps.some((step) => /Webflow/.test(step.title)), ok.steps.map((step) => step.title).join(','));
  assert.match(checkStep(ok, 'Deploy hook').message, /no Webflow/);
  assert.equal(ok.ok, true);
  const bad = await runCheck(defaultConfig, { ...shopEnv, DEPLOY_HOOK_URL: 'http://insecure.test' }, { deep: false });
  assert.match(checkStep(bad, 'Deploy hook').message, /must be an https URL/);
});

test('deploy hook: a network error keeps the build pending for the next run', async () => {
  const { createDeployHook } = await import('../src/deploy.ts');
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
