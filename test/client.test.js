// The Storefront client's query text: what the market puts into @inContext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withContext, request, TetherError } from '../src/client.js';

const QUERY = 'query TetherProduct($handle: String!) { product(handle: $handle) { id } }';

test('withContext writes the market as Shopify codes', () => {
  assert.equal(
    withContext(QUERY, { country: 'nl', language: 'nl-NL' }),
    'query TetherProduct($handle: String!) @inContext(country: NL, language: NL) { product(handle: $handle) { id } }',
  );
  assert.match(withContext(QUERY, { country: 'BR', language: 'pt-BR' }), /@inContext\(country: BR, language: PT_BR\)/);
});

test('withContext leaves out a country or language that is not a code, so page input never becomes query text', () => {
  const injected = 'NL) { shop { name } } query X @inContext(country: NL';
  const withBadLanguage = withContext(QUERY, { country: 'DE', language: injected });
  assert.match(withBadLanguage, /@inContext\(country: DE\) \{ product/);
  assert.doesNotMatch(withBadLanguage, /shop/);
  assert.equal(withContext(QUERY, { country: injected }), QUERY);
  assert.equal(withContext(QUERY, { country: 'XX' }), QUERY, "Cloudflare's unknown country");
});

test('a token without inventory access costs one extra request per store, then queries leave the field out', async () => {
  const queries = [];
  const conf = {
    domain: 'no-inventory.test',
    token: 't',
    apiVersion: '2026-07',
    maxAge: 0,
    retries: 0,
    fetch: async (url, init) => {
      const { query } = JSON.parse(init.body);
      queries.push(query);
      if (query.includes('quantityAvailable')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ errors: [{ message: 'Access denied for quantityAvailable field.' }] }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: { product: { id: '1' } } }) };
    },
  };
  const query = 'query P { product(handle: "x") { id variants(first: 1) { nodes { id quantityAvailable } } } }';
  assert.deepEqual(await request(conf, query, {}, { context: false }), { product: { id: '1' } });
  assert.equal(queries.length, 2);
  assert.deepEqual(await request(conf, query, {}, { context: false }), { product: { id: '1' } });
  assert.equal(queries.length, 3, 'the second query goes out without the field at once');
  assert.doesNotMatch(queries[2], /quantityAvailable/);
});

test('request errors are TetherErrors with a code', async () => {
  const conf = { domain: 'down.test', token: 't', apiVersion: '2026-07', maxAge: 0, retries: 0 };
  await assert.rejects(request({ ...conf, domain: '' }, '{ shop { name } }'), {
    name: 'TetherError',
    code: 'NOT_CONFIGURED',
  });
  const offline = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(request({ ...conf, fetch: offline }, '{ shop { name } }'), { code: 'NETWORK' });
  const unauthorized = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const error = await request({ ...conf, fetch: unauthorized }, '{ shop { name } }').catch((e) => e);
  assert.ok(error instanceof TetherError);
  assert.equal(error.code, 'HTTP_401');
  assert.equal(error.status, 401);
});
