// Settings parsed from the env that more than one module reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployHookMinSeconds, invalidNumberSettings, maxSubrequests } from '../src/settings.ts';
import { runCheck } from '../src/check.ts';
import defaultConfig from './default-config.js';
import { checkStep } from './mocks.js';

test('DEPLOY_HOOK_MIN_SECONDS: a whole number up to a day is used, anything else falls back to 60 seconds', () => {
  assert.equal(deployHookMinSeconds({ DEPLOY_HOOK_MIN_SECONDS: '300' }), 300);
  assert.equal(deployHookMinSeconds({ DEPLOY_HOOK_MIN_SECONDS: '0' }), 0);
  assert.equal(deployHookMinSeconds({ DEPLOY_HOOK_MIN_SECONDS: '86400' }), 86_400);
  for (const raw of ['soon', '-5', '1e3', '45.9', '86401']) {
    assert.equal(deployHookMinSeconds({ DEPLOY_HOOK_MIN_SECONDS: raw }), 60, raw);
  }
  assert.equal(deployHookMinSeconds({}), 60);
});

test('MAX_SUBREQUESTS: a positive whole number is used, anything else falls back to 45', () => {
  assert.equal(maxSubrequests({ MAX_SUBREQUESTS: '1000' }), 1000);
  assert.equal(maxSubrequests({ MAX_SUBREQUESTS: '1' }), 1);
  for (const raw of ['0', '-1', '1e3', '45.9', 'lots', '10000001']) {
    assert.equal(maxSubrequests({ MAX_SUBREQUESTS: raw }), 45, raw);
  }
  assert.equal(maxSubrequests({}), 45);
});

test('only whole-number settings that are set and unusable are invalid', () => {
  assert.deepEqual(invalidNumberSettings({ MAX_SUBREQUESTS: '200', DEPLOY_HOOK_MIN_SECONDS: '120' }), []);
  assert.deepEqual(invalidNumberSettings({}), []);
  assert.deepEqual(invalidNumberSettings({ MAX_SUBREQUESTS: '-1' }), [
    { key: 'MAX_SUBREQUESTS', raw: '-1', min: 1, max: 10_000_000, fallback: 45 },
  ]);
});

test('the setup check reports an unusable whole-number setting as an error that names it', async () => {
  const env = { SHOPIFY_DOMAIN: 'shop.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'shpat_token' };
  const report = await runCheck(
    defaultConfig,
    { ...env, MAX_SUBREQUESTS: '1e3', DEPLOY_HOOK_MIN_SECONDS: '-5' },
    {
      deep: false,
    },
  );
  assert.equal(report.ok, false);
  const subrequests = checkStep(report, 'MAX_SUBREQUESTS');
  assert.equal(subrequests.level, 'error');
  assert.match(subrequests.message, /"1e3" is not a whole number from 1 to 10000000, so 45 is used/);
  const interval = checkStep(report, 'DEPLOY_HOOK_MIN_SECONDS');
  assert.equal(interval.level, 'error');
  assert.match(interval.message, /"-5" is not a whole number from 0 to 86400, so 60 is used/);
});

test('the setup check reports the deploy interval the sync uses', async () => {
  const env = {
    SHOPIFY_DOMAIN: 'shop.myshopify.com',
    SHOPIFY_ADMIN_TOKEN: 'shpat_token',
    DEPLOY_HOOK_URL: 'https://api.netlify.com/build_hooks/abc',
  };
  const message = async (/** @type {Record<string, string>} */ extra) =>
    checkStep(await runCheck(defaultConfig, { ...env, ...extra }, { deep: false }), 'Deploy hook').message;
  assert.match(await message({ DEPLOY_HOOK_MIN_SECONDS: '300' }), /at most every 300s/);
  assert.match(await message({ DEPLOY_HOOK_MIN_SECONDS: 'soon' }), /at most every 60s/);
});
