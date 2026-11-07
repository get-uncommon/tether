// configure() parses every option where it arrives: an invalid value warns and falls back to its default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULTS, callHook, cfg, configure, resolveConfig } from '../src/config.ts';
import { isQuarterlyVersion } from '../src/api-version.ts';

/**
 * @template T
 * @param {() => T} fn
 */
const quietly = (fn) => {
  /** @type {string[]} */
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

test('a delay longer than setTimeout keeps is capped at the longest one instead of firing at once', () => {
  const { result, warned } = quietly(() =>
    resolveConfig({ requestTimeout: 1e10, searchDelay: Number.MAX_SAFE_INTEGER }),
  );
  assert.equal(result.requestTimeout, 2_147_483_647);
  assert.equal(result.searchDelay, 2_147_483_647);
  assert.deepEqual(warned, [
    '[tether] requestTimeout 10000000000 is more than its maximum: using 2147483647',
    '[tether] searchDelay 9007199254740991 is more than its maximum: using 2147483647',
  ]);
  assert.equal(resolveConfig({ requestTimeout: 2_147_483_647 }).requestTimeout, 2_147_483_647);
});

test('retries above ten are capped at ten, and a count that is no non-negative integer falls back to the default', () => {
  const { result, warned } = quietly(() => resolveConfig({ retries: 15 }));
  assert.equal(result.retries, 10);
  assert.deepEqual(warned, ['[tether] retries 15 is more than its maximum: using 10']);
  assert.equal(resolveConfig({ retries: 10 }).retries, 10);
  for (const retries of [-1, 1.5, Number.POSITIVE_INFINITY, '3']) {
    assert.equal(quietly(() => resolveConfig({ retries })).result.retries, DEFAULTS.retries);
  }
});

test("a connection size takes 1 to Shopify's 250: a larger one is capped, a smaller one uses the default", () => {
  const names = /** @type {const} */ ([
    'imagesFirst',
    'variantsFirst',
    'sellingPlanGroupsFirst',
    'sellingPlansFirst',
    'collectionFirst',
  ]);
  const capped = quietly(() => resolveConfig(Object.fromEntries(names.map((name) => [name, 300]))));
  assert.deepEqual(
    capped.warned,
    names.map((name) => `[tether] ${name} 300 is more than its maximum: using 250`),
  );
  const empty = quietly(() => resolveConfig(Object.fromEntries(names.map((name) => [name, 0]))));
  assert.equal(empty.warned.length, names.length);
  for (const name of names) {
    assert.equal(capped.result[name], 250);
    assert.equal(empty.result[name], DEFAULTS[name], `${name}: 0 asks for nothing`);
    assert.equal(resolveConfig({ [name]: 250 })[name], 250);
    assert.equal(resolveConfig({ [name]: 1 })[name], 1);
  }
});

test('cartDrawerOpenClass is one class token: an empty one or one with whitespace uses is-open', () => {
  for (const cartDrawerOpenClass of ['', 'is-open active', ' open', 3]) {
    const { result, warned } = quietly(() => resolveConfig({ cartDrawerOpenClass }));
    assert.equal(result.cartDrawerOpenClass, 'is-open');
    assert.deepEqual(warned, [
      `[tether] invalid cartDrawerOpenClass ${JSON.stringify(cartDrawerOpenClass)}: using "is-open"`,
    ]);
  }
  assert.equal(resolveConfig({ cartDrawerOpenClass: 'drawer--open' }).cartDrawerOpenClass, 'drawer--open');
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

test('hooks that are not functions are dropped with a warning; the domain loses protocol and path', () => {
  const onError = () => {};
  const { result, warned } = quietly(() =>
    resolveConfig({
      onError,
      onCartOpen: 'open',
      formatMoney: null,
      onLineEnter: undefined,
      domain: 'https://shop.example/admin',
      token: 't',
    }),
  );
  assert.equal(result.onError, onError);
  assert.equal(result.onCartOpen, null);
  assert.equal(result.formatMoney, null);
  assert.equal(result.onLineEnter, null);
  assert.deepEqual(warned, ['[tether] invalid onCartOpen "open": ignored']);
  assert.equal(result.domain, 'shop.example');
  assert.equal(result.storageKey, 'tether:cart:shop.example');
});

test('a hook that throws gets its fallback and is reported, whatever it throws; an Error once for each message', () => {
  /** @type {[string, unknown][]} */
  const reported = [];
  let warnings = 0;
  const { warn } = console;
  console.warn = () => {
    warnings++;
  };
  configure({ domain: 'shop.test', token: 't', onError: (error, context) => reported.push([context, error]) });
  /** @param {unknown} thrown */
  const throwing = (thrown) => () => {
    throw thrown;
  };
  /** @type {unknown} */
  const noText = Object.create(null);
  const brokenText = {
    toString() {
      throw new Error('no text');
    },
  };
  try {
    for (const thrown of [noText, noText, brokenText]) {
      assert.equal(
        callHook('formatMoney', throwing(thrown), () => 'built-in'),
        'built-in',
      );
    }
    for (const message of ['first bug', 'second bug', 'first bug']) {
      callHook('formatMoney', throwing(new Error(message)), () => 'built-in');
    }
    callHook('onCartOpen', throwing(new Error('first bug')));
    callHook('onCartOpen', throwing(new Error('first bug')));
    assert.deepEqual(
      reported.map(([context, error]) => [context, error instanceof Error ? error.message : error]),
      [
        ['formatMoney', noText],
        ['formatMoney', noText],
        ['formatMoney', brokenText],
        ['formatMoney', 'first bug'],
        ['formatMoney', 'second bug'],
        ['onCartOpen', 'first bug'],
      ],
    );
    assert.equal(warnings, reported.length, 'each one is logged too');
  } finally {
    console.warn = warn;
    configure({ domain: 'shop.test', token: 't' });
  }
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
  assert.match(unstable.warned[0] ?? '', /changes without notice/);
});

test('the default apiVersion is a dated version, as the config types it', () => {
  assert.ok(isQuarterlyVersion(DEFAULTS.apiVersion));
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
  const inherited = quietly(() => resolveConfig({ constructor: 1, toString: 2 }));
  assert.deepEqual(inherited.warned, [
    '[tether] unknown option "constructor": ignored',
    '[tether] unknown option "toString": ignored',
  ]);
});

test('partsUrl must be https or on the site, checked when the config is resolved', () => {
  /** @param {string} partsUrl */
  const resolve = (partsUrl) => quietly(() => resolveConfig({ partsUrl }));
  assert.equal(resolve('https://cdn.test/tether/').result.partsUrl, 'https://cdn.test/tether/');
  assert.equal(resolve('/assets/tether/').result.partsUrl, '/assets/tether/');
  const plain = resolve('http://cdn.test/tether/');
  assert.equal(plain.result.partsUrl, null);
  assert.equal(plain.warned.length, 1);
  assert.equal(resolve('javascript:alert(1)').result.partsUrl, null);
});

test('embedOrigins keeps https origins alone, and skips every other entry with a warning', () => {
  const { result, warned } = quietly(() =>
    resolveConfig({
      embedOrigins: [
        'https://video.test',
        'https://Player.Video.test/',
        'http://video.test',
        'https://video.test/embed',
        'https://video.test?x=1',
        'https://user@video.test',
        'video.test',
        42,
      ],
    }),
  );
  assert.deepEqual(result.embedOrigins, ['https://video.test', 'https://player.video.test']);
  assert.equal(warned.length, 6);
  const notAList = quietly(() => resolveConfig({ embedOrigins: 'https://video.test' }));
  assert.deepEqual(notAList.result.embedOrigins, []);
  assert.equal(notAList.warned.length, 1);
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
      const detect = configView.markets?.detect;
      assert.ok(Array.isArray(detect), 'the configured detect list');
      detect.push('server');
    }, TypeError);
  });
  assert.equal(cfg.prefix, 'tether');
  assert.deepEqual(cfg.markets?.detect, ['saved']);
  assert.equal(warned.length, 2);
  quietly(() => configure({ domain: 'other.test' }));
  assert.equal(configView.domain, 'other.test', 'a view, not a copy');
});

test('Tether.config gives the same view of an object on every read, and a new one when configure() replaces it', async () => {
  const { configView } = await import('../src/config.ts');
  quietly(() => configure({ domain: 'shop.test', markets: { detect: ['saved'] } }));
  const markets = configView.markets;
  assert.equal(configView.markets, markets);
  assert.equal(configView.markets?.detect, markets?.detect);
  quietly(() => configure({ markets: { detect: ['server'] } }));
  assert.notEqual(configView.markets, markets);
  assert.deepEqual(configView.markets?.detect, ['server']);
  assert.equal(configView.markets, configView.markets);
});

test("Tether.config's descriptors hand out read-only views too, never the live objects", async () => {
  const { configView } = await import('../src/config.ts');
  quietly(() => configure({ domain: 'shop.test', markets: { detect: ['saved'] } }));
  /** @type {unknown} */
  const markets = Object.getOwnPropertyDescriptor(configView, 'markets')?.value;
  assert.equal(markets, configView.markets, 'the same view a read gives');
  assert.notEqual(markets, cfg.markets);
  assert.equal(Object.getOwnPropertyDescriptors(configView).markets.value, configView.markets);
  assert.equal(Object.getOwnPropertyDescriptor(configView, 'domain')?.value, 'shop.test');
  const { warned } = quietly(() => {
    assert.throws(() => {
      /** @type {{ detect: string[] }} */ (markets).detect = ['server'];
    }, TypeError);
  });
  assert.deepEqual(cfg.markets?.detect, ['saved']);
  assert.equal(warned.length, 1);
});

test("docs/reference.md's Config table has a row for every option and every field of a nested one", async () => {
  const { ACCOUNT, ANALYTICS, MARKETS } = await import('../src/config-sections.ts');
  const reference = await readFile(new URL('../docs/reference.md', import.meta.url), 'utf8');
  const config = reference.slice(reference.indexOf('\n## Config\n'), reference.indexOf('\n## Troubleshooting'));
  const options = [
    ...Object.keys(DEFAULTS),
    ...Object.keys(MARKETS).map((key) => `markets.${key}`),
    ...Object.keys(ANALYTICS).map((key) => `analytics.${key}`),
    ...Object.keys(ACCOUNT).map((key) => `account.${key}`),
  ];
  const missing = options.filter((option) => !config.includes(`\n| \`${option}\``));
  assert.deepEqual(missing, [], 'options without a row in the Config table');
});
