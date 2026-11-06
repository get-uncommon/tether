// The Astro integration's config step, beyond what astro.test.js covers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { default: tether } = await import('../src/astro.ts');

test('integration: inject false adds no script; the options are not changed by a run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'astro-options-'));
  await writeFile(join(dir, '.env'), 'PUBLIC_SHOPIFY_DOMAIN=a.myshopify.com\nPUBLIC_SHOPIFY_STOREFRONT_TOKEN=t\n');
  const prev = { ...process.env };
  delete process.env.PUBLIC_SHOPIFY_DOMAIN;
  delete process.env.PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  const scripts = [];
  const updates = [];
  const onError = () => {};
  const options = { inject: false, country: 'NL', onError };
  try {
    await tether(options).hooks['astro:config:setup']({
      injectScript: (stage, code) => scripts.push(code),
      command: 'build',
      config: { root: pathToFileURL(`${dir}/`) },
      logger: { warn() {} },
      // Astro isn't installed here, so there is no envField to declare the variables with.
      updateConfig: (config) => updates.push(config),
    });
  } finally {
    process.env = prev;
  }
  assert.deepEqual(scripts, []);
  assert.deepEqual(updates, []);
  assert.deepEqual(options, { inject: false, country: 'NL', onError });
});

test('integration: server-only options stay out of the page silently, unknown ones with a warning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'astro-options-'));
  const scripts = [];
  const warnings = [];
  await tether({
    domain: 'a.myshopify.com',
    token: 't',
    siteUrl: 'https://shop.test',
    pageSize: 50,
    opneCart: true,
  }).hooks['astro:config:setup']({
    injectScript: (stage, code) => scripts.push(code),
    command: 'build',
    config: { root: pathToFileURL(`${dir}/`) },
    logger: { warn: (message) => warnings.push(message) },
  });
  const page = scripts.find((code) => code.includes('TETHER_CONFIG'));
  assert.match(page, /"domain":"a\.myshopify\.com"/);
  assert.doesNotMatch(page, /siteUrl|pageSize|opneCart/);
  assert.deepEqual(warnings, ['opneCart is not a Tether option: left out of the page.']);
});
