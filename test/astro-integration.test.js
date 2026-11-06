// The Astro integration's config step: the page script it injects, the .env files it reads, and the token checks.
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
  delete process.env['PUBLIC_SHOPIFY_DOMAIN'];
  delete process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'];
  /** @type {string[]} */
  const scripts = [];
  /** @type {unknown[]} */
  const updates = [];
  const onError = () => {};
  const options = { inject: false, country: 'NL', onError };
  try {
    await tether(options).hooks['astro:config:setup']({
      injectScript: (_stage, code) => scripts.push(code),
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
  /** @type {string[]} */
  const scripts = [];
  /** @type {string[]} */
  const warnings = [];
  await tether({
    domain: 'a.myshopify.com',
    token: 't',
    siteUrl: 'https://shop.test',
    pageSize: 50,
    // @ts-expect-error -- a misspelt option
    opneCart: true,
  }).hooks['astro:config:setup']({
    injectScript: (_stage, code) => scripts.push(code),
    command: 'build',
    config: { root: pathToFileURL(`${dir}/`) },
    logger: { warn: (message) => warnings.push(message) },
  });
  const page = scripts.find((code) => code.includes('TETHER_CONFIG'));
  assert.ok(page, 'the page script');
  assert.match(page, /"domain":"a\.myshopify\.com"/);
  assert.doesNotMatch(page, /siteUrl|pageSize|opneCart/);
  assert.deepEqual(warnings, ['opneCart is not a Tether option: left out of the page.']);
});

test('integration: injects the page script with .env values, drops functions with a warning', async () => {
  const { default: tether } = await import('../src/astro.ts');
  const prev = { ...process.env };
  process.env['PUBLIC_SHOPIFY_DOMAIN'] = 'env-shop.myshopify.com';
  process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'] = 'env-token';
  /** @type {{ stage: string, code: string }[]} */
  const scripts = [];
  /** @type {string[]} */
  const warnings = [];
  // @ts-expect-error -- a function can't reach the page: the integration drops it with a warning
  await tether({ country: 'NL', onError: () => {} }).hooks['astro:config:setup']({
    injectScript: (stage, code) => scripts.push({ stage, code }),
    command: 'build',
    config: { root: pathToFileURL(join(tmpdir(), 'astro-site/')) },
    logger: { warn: (message) => warnings.push(message) },
  });
  process.env = prev;
  assert.deepEqual(
    scripts.map((script) => script.stage),
    ['head-inline', 'page'],
  );
  const [inline, pageScript] = scripts;
  assert.ok(inline && pageScript);
  assert.match(inline.code, /TETHER_INTEGRATION/, 'no second auto-start from window.TETHER_CONFIG');
  const page = pageScript.code;
  assert.match(page, /import Tether from '@occluze\/tether'/);
  assert.match(page, /"domain":"env-shop\.myshopify\.com"/);
  assert.match(page, /"country":"NL"/);
  assert.ok(!page.includes('onError'));
  assert.match(warnings.join(' '), /onError: functions can't be passed here/);
});

test('integration: warns clearly when the store is missing', async () => {
  const { default: tether } = await import('../src/astro.ts');
  const prev = { ...process.env };
  delete process.env['PUBLIC_SHOPIFY_DOMAIN'];
  delete process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'];
  /** @type {string[]} */
  const warnings = [];
  await tether().hooks['astro:config:setup']({
    injectScript() {},
    command: 'dev',
    config: { root: pathToFileURL(join(tmpdir(), 'none/')) },
    logger: { warn: (message) => warnings.push(message) },
  });
  process.env = prev;
  assert.match(warnings.join(' '), /PUBLIC_SHOPIFY_DOMAIN and PUBLIC_SHOPIFY_STOREFRONT_TOKEN/);
});

test('integration: reads .env, .env.local and .env.production like Vite (process.env wins)', async () => {
  const { default: tether } = await import('../src/astro.ts');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'astro env '));
  await writeFile(
    join(dir, '.env'),
    '# comment\nPUBLIC_SHOPIFY_DOMAIN=from-env.myshopify.com\nPUBLIC_SHOPIFY_STOREFRONT_TOKEN="quoted-token" # note\n',
  );
  await writeFile(join(dir, '.env.production'), 'PUBLIC_SHOPIFY_DOMAIN=prod.myshopify.com\n');
  const prev = { ...process.env };
  delete process.env['PUBLIC_SHOPIFY_DOMAIN'];
  delete process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'];
  /** @type {string[]} */
  const scripts = [];
  await tether().hooks['astro:config:setup']({
    injectScript: (_stage, code) => scripts.push(code),
    command: 'build',
    config: { root: pathToFileURL(`${dir}/`) },
    logger: { warn() {} },
  });
  process.env = prev;
  const pageScript = scripts[1];
  assert.ok(pageScript);
  assert.match(pageScript, /"domain":"prod\.myshopify\.com"/, '.env.production wins over .env');
  assert.match(pageScript, /"token":"quoted-token"/);
});

test('integration: --mode picks the .env file; shop.config.js changes restart the dev server', async () => {
  const { default: tether } = await import('../src/astro.ts');
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'astro-mode-'));
  await writeFile(
    join(dir, '.env.staging'),
    'PUBLIC_SHOPIFY_DOMAIN=staging.myshopify.com\nPUBLIC_SHOPIFY_STOREFRONT_TOKEN=s\n',
  );
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'shop.config.js'), 'export default {};\n');
  const prev = { ...process.env };
  const argv = process.argv;
  delete process.env['PUBLIC_SHOPIFY_DOMAIN'];
  delete process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'];
  process.argv = [...argv, '--mode', 'staging'];
  /** @type {string[]} */
  const scripts = [];
  /** @type {string[]} */
  const watched = [];
  try {
    await tether().hooks['astro:config:setup']({
      injectScript: (_stage, code) => scripts.push(code),
      command: 'dev',
      addWatchFile: (file) => watched.push(file),
      config: { root: pathToFileURL(`${dir}/`) },
      logger: { warn() {} },
    });
  } finally {
    process.env = prev;
    process.argv = argv;
  }
  assert.match(scripts[1] ?? '', /"domain":"staging\.myshopify\.com"/);
  assert.deepEqual(watched, [join(dir, 'src', 'shop.config.js')]);
});

test('integration: a secret Shopify token is never written into pages, and a non-PUBLIC name is flagged', async () => {
  const { default: tether } = await import('../src/astro.ts');
  const prev = { ...process.env };
  /**
   * @param {string[]} warnings
   * @param {string[]} [scripts]
   */
  const setup = (warnings, scripts = []) =>
    tether().hooks['astro:config:setup']({
      injectScript: (_stage, code) => scripts.push(code),
      command: 'build',
      config: { root: pathToFileURL(join(tmpdir(), 'astro-secret/')) },
      logger: { warn: (message) => warnings.push(message) },
    });
  try {
    delete process.env['PUBLIC_SHOPIFY_STOREFRONT_TOKEN'];
    process.env['PUBLIC_SHOPIFY_DOMAIN'] = 'shop.myshopify.com';
    process.env['SHOPIFY_STOREFRONT_TOKEN'] = 'shpat_0123456789abcdef';
    /** @type {string[]} */
    const scripts = [];
    await assert.rejects(setup([], scripts), /secret token/);
    assert.ok(!scripts.join('').includes('shpat_'), 'nothing was injected');

    process.env['SHOPIFY_STOREFRONT_TOKEN'] = '0123456789abcdef0123456789abcdef';
    /** @type {string[]} */
    const warnings = [];
    await setup(warnings);
    assert.match(warnings.join(' '), /SHOPIFY_STOREFRONT_TOKEN is written into every page/);
  } finally {
    process.env = prev;
  }
});
