// Settings parsed from the env that more than one module reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployHookMinSeconds } from '../src/settings.ts';
import { runCheck } from '../src/check.ts';
import defaultConfig from './default-config.js';

test('DEPLOY_HOOK_MIN_SECONDS: a number is used, anything else falls back to 60 seconds', () => {
  assert.equal(deployHookMinSeconds({ DEPLOY_HOOK_MIN_SECONDS: '300' }), 300);
  assert.equal(deployHookMinSeconds({ DEPLOY_HOOK_MIN_SECONDS: '0' }), 0);
  assert.equal(deployHookMinSeconds({ DEPLOY_HOOK_MIN_SECONDS: 'soon' }), 60);
  assert.equal(deployHookMinSeconds({}), 60);
});

test('the setup check reports the deploy interval the sync uses', async () => {
  const env = {
    SHOPIFY_DOMAIN: 'shop.myshopify.com',
    SHOPIFY_ADMIN_TOKEN: 'shpat_token',
    DEPLOY_HOOK_URL: 'https://api.netlify.com/build_hooks/abc',
  };
  const message = async (extra) =>
    (await runCheck(defaultConfig, { ...env, ...extra }, { deep: false })).steps.find(
      (step) => step.title === 'Deploy hook',
    ).message;
  assert.match(await message({ DEPLOY_HOOK_MIN_SECONDS: '300' }), /at most every 300s/);
  assert.match(await message({ DEPLOY_HOOK_MIN_SECONDS: 'soon' }), /at most every 60s/);
});
