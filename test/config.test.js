// What configure() accepts: options that become query text or attribute names fall back to their default when invalid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, cfg, configure, resolveConfig } from '../src/config.js';

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
