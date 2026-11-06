// configure() parses every option where it arrives: an invalid value warns and falls back to its default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, cfg, configure, resolveConfig } from '../src/config.ts';

const quietly = (fn) => {
  const warned = [];
  const { warn } = console;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    return { result: fn(), warned };
  } finally {
    console.warn = warn;
  }
};

test('counts must be whole numbers of 0 or more', () => {
  const { result, warned } = quietly(() =>
    resolveConfig({
      imagesFirst: 3,
      retries: 0,
      variantsFirst: -1,
      maxAge: 1.5,
      lowStock: '5',
      collectionFirst: '12) { x }',
    }),
  );
  assert.equal(result.imagesFirst, 3);
  assert.equal(result.retries, 0);
  assert.equal(result.variantsFirst, DEFAULTS.variantsFirst);
  assert.equal(result.maxAge, DEFAULTS.maxAge);
  assert.equal(result.lowStock, DEFAULTS.lowStock);
  assert.equal(result.collectionFirst, DEFAULTS.collectionFirst);
  assert.equal(warned.length, 4);
});

test('prefix, checkoutTarget and defaultPurchase fall back to their defaults', () => {
  const { result, warned } = quietly(() =>
    resolveConfig({ prefix: 'x"] *', checkoutTarget: '_top', defaultPurchase: 'subscription' }),
  );
  assert.equal(result.prefix, 'tether');
  assert.equal(result.checkoutTarget, '_self');
  assert.equal(result.defaultPurchase, 'subscription');
  assert.equal(warned.length, 2);
  assert.equal(quietly(() => resolveConfig({ prefix: 'wfs' })).result.prefix, 'wfs');
});

test('metafields keep valid identifiers as written and skip the rest', () => {
  const { result, warned } = quietly(() =>
    resolveConfig({
      metafields: [
        'custom.material',
        { namespace: 'custom', key: 'care_guide' },
        '$app:reviews.rating',
        'custom.a"}) { x }',
        'nodot',
      ],
    }),
  );
  assert.deepEqual(result.metafields, [
    'custom.material',
    { namespace: 'custom', key: 'care_guide' },
    '$app:reviews.rating',
  ]);
  assert.equal(warned.length, 2);
});

test('hooks that are not functions are dropped; the domain loses protocol and path', () => {
  const onError = () => {};
  const { result } = quietly(() =>
    resolveConfig({ onError, onCartOpen: 'open', domain: 'https://shop.example/admin', token: 't' }),
  );
  assert.equal(result.onError, onError);
  assert.equal(result.onCartOpen, null);
  assert.equal(result.domain, 'shop.example');
  assert.equal(result.storageKey, 'tether:cart:shop.example');
});

test('configure replaces the shared config in place', () => {
  const shared = cfg;
  quietly(() => configure({ domain: 'a.test', token: 't', prefix: 'wfs' }));
  assert.equal(shared.prefix, 'wfs');
  quietly(() => configure({}));
  assert.equal(cfg, shared);
  assert.equal(shared.prefix, 'tether');
  assert.equal(shared.domain, '');
});

test('the domain must be a host name, and apiVersion a dated version', () => {
  const { result, warned } = quietly(() => resolveConfig({ domain: 'a.com:1@b.com', apiVersion: '2026-07/../x' }));
  assert.equal(result.domain, '');
  assert.equal(result.apiVersion, DEFAULTS.apiVersion);
  assert.equal(warned.length, 2);
  assert.equal(resolveConfig({ apiVersion: '2025-10' }).apiVersion, '2025-10');
  const unstable = quietly(() => resolveConfig({ apiVersion: 'unstable' }));
  assert.equal(unstable.result.apiVersion, 'unstable');
  assert.match(unstable.warned[0], /changes without notice/);
});

test('country and language become Shopify codes, or nothing', () => {
  assert.equal(resolveConfig({ country: 'de', language: 'pt-BR' }).country, 'DE');
  assert.equal(resolveConfig({ country: 'de', language: 'pt-BR' }).language, 'PT_BR');
  const { result, warned } = quietly(() => resolveConfig({ country: 'NL) { x }', language: 'Deutsch!' }));
  assert.equal(result.country, undefined);
  assert.equal(result.language, undefined);
  assert.equal(warned.length, 2);
});

test('account URLs must be on the site or https; the rest of the account options keep their types', () => {
  const navigate = () => {};
  const { result, warned } = quietly(() =>
    resolveConfig({
      account: {
        server: '/_tether/account',
        orderUrl: '/account/order?id={id}',
        subscriptionsUrl: 'javascript:alert(1)',
        paymentUrl: 'ftp://evil.test/pay',
        logoutUrl: 'http://localhost:4321/',
        locale: 42,
        navigate,
      },
    }),
  );
  assert.deepEqual(result.account, {
    server: '/_tether/account',
    orderUrl: '/account/order?id={id}',
    logoutUrl: 'http://localhost:4321/',
    navigate,
  });
  assert.equal(warned.length, 3, warned.join('\n'));
  assert.equal(quietly(() => resolveConfig({ account: 'yes' })).result.account, null);
});

test('an account without a usable server is off, with a warning that says to set account.server', () => {
  for (const account of [{ clientId: 'client-1', remember: true }, { server: 'http://evil.test/_tether' }]) {
    const { result, warned } = quietly(() => resolveConfig({ account }));
    assert.equal(result.account, null);
    assert.ok(
      warned.some((line) => line.includes('customer accounts need the Worker since 0.7.0: set account.server')),
      warned.join('\n'),
    );
  }
});

test('markets and analytics keep the values of the right kind', () => {
  const onEvent = () => {};
  const { result, warned } = quietly(() =>
    resolveConfig({
      markets: { detect: ['saved', 'geo'], locales: { nl: { country: 'NL', locale: 7 } }, cookie: 'a b', strict: true },
      analytics: { dataLayer: 'window.x=1', shopify: { consent: 'default-banner', proxy: '/api' }, onEvent },
    }),
  );
  assert.deepEqual(result.markets, { detect: ['saved'], locales: { nl: { country: 'NL' } }, strict: true });
  assert.deepEqual(result.analytics, { shopify: { consent: 'default-banner', proxy: true }, onEvent });
  assert.equal(warned.length, 2, warned.join('\n'));
  assert.equal(resolveConfig({}).markets, null);
  assert.equal(resolveConfig({ analytics: { dataLayer: true } }).analytics?.dataLayer, true);
});

test('an unknown or misspelt option warns and never reaches the config', () => {
  const { result, warned } = quietly(() => resolveConfig({ openCartOnAd: false, domain: 'shop.test' }));
  assert.equal('openCartOnAd' in result, false);
  assert.equal(result.openCartOnAdd, true);
  assert.deepEqual(warned, ['[tether] unknown option "openCartOnAd": ignored']);
});

test('partsUrl must be https or on the site, checked when the config is resolved', () => {
  const resolve = (partsUrl) => quietly(() => resolveConfig({ partsUrl }));
  assert.equal(resolve('https://cdn.test/tether/').result.partsUrl, 'https://cdn.test/tether/');
  assert.equal(resolve('/assets/tether/').result.partsUrl, '/assets/tether/');
  const plain = resolve('http://cdn.test/tether/');
  assert.equal(plain.result.partsUrl, null);
  assert.equal(plain.warned.length, 1);
  assert.equal(resolve('javascript:alert(1)').result.partsUrl, null);
});

test('Tether.config shows the live config and refuses writes, which would skip validation', async () => {
  const { configView } = await import('../src/config.ts');
  quietly(() => configure({ domain: 'shop.test', markets: { detect: ['saved'] } }));
  assert.equal(configView.domain, 'shop.test');
  const { warned } = quietly(() => {
    assert.throws(() => {
      configView.prefix = 'x"] *';
    }, TypeError);
    assert.throws(() => {
      configView.markets.detect.push('server');
    }, TypeError);
  });
  assert.equal(cfg.prefix, 'tether');
  assert.deepEqual(cfg.markets.detect, ['saved']);
  assert.equal(warned.length, 2);
  quietly(() => configure({ domain: 'other.test' }));
  assert.equal(configView.domain, 'other.test', 'a view, not a copy');
});
