import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withContext, request, TetherError } from '../src/client.ts';

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

test('a token without inventory access costs one extra request per store, then Tether writes queries without the field', async () => {
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
  const accessSeen = [];
  const query = (access) => {
    accessSeen.push(access.inventory);
    return `query P { product(handle: "x") { id variants(first: 1) { nodes { id ${access.inventory ? 'quantityAvailable' : ''} } } } }`;
  };
  assert.deepEqual(await request(conf, query, {}, { context: false }), { product: { id: '1' } });
  assert.equal(queries.length, 2);
  assert.deepEqual(await request(conf, query, {}, { context: false }), { product: { id: '1' } });
  assert.equal(queries.length, 3, 'the second query goes out without the field at once');
  assert.doesNotMatch(queries[2], /quantityAvailable/);
  assert.deepEqual(accessSeen, [true, false, false]);

  const ownQuery = 'query Own { product(handle: "x") { variants(first: 1) { nodes { quantityAvailable } } } }';
  await assert.rejects(request(conf, ownQuery, {}, { context: false }), {
    name: 'TetherError',
    message: 'Access denied for quantityAvailable field.',
  });
  assert.equal(
    queries.at(-1),
    ownQuery,
    "a query the caller wrote is sent as written, and Shopify's refusal is its error",
  );
});

test('an answer that is not in the GraphQL shape is a TetherError, not a crash', async () => {
  const conf = { domain: 'odd.test', token: 't', apiVersion: '2026-07', maxAge: 0, retries: 0 };
  const answering = (body) => ({ ...conf, fetch: async () => ({ ok: true, status: 200, json: async () => body }) });
  await assert.rejects(request(answering({ errors: 'boom' }), '{ shop { name } }'), {
    name: 'TetherError',
    message: 'Invalid response (200)',
  });
  await assert.rejects(request(answering([1, 2]), '{ shop { name } }'), { name: 'TetherError' });
  await assert.rejects(request(answering({ errors: [{ code: 1 }, null, { message: 'Field missing' }] }), '{ x }'), {
    name: 'TetherError',
    message: 'Field missing',
  });
  await assert.rejects(request(answering({ errors: [{ extensions: { code: 7 } }] }), '{ x }'), {
    name: 'TetherError',
    message: 'Storefront API error',
  });
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

test('@inContext goes into the operation header, whatever the rest of the document mentions', () => {
  const market = { country: 'NL' };
  assert.equal(
    withContext('# uses @inContext below\nquery A($q: String = "a)b") { search(query: $q) { id } }', market),
    '# uses @inContext below\nquery A($q: String = "a)b") @inContext(country: NL) { search(query: $q) { id } }',
  );
  assert.equal(
    withContext('query A @cached { shop { name } }', market),
    'query A @inContext(country: NL) @cached { shop { name } }',
  );
  assert.equal(withContext('  { shop { name } }', market), 'query @inContext(country: NL) { shop { name } }');
  assert.equal(withContext('mutation M { x }', market), 'mutation M @inContext(country: NL) { x }');
  const own = 'query A @inContext(country: DE) { shop { name } }';
  assert.equal(withContext(own, market), own, 'its own market stays');
  const fragmentFirst = 'fragment F on Shop { name } query A { shop { ...F } }';
  assert.equal(withContext(fragmentFirst, market), fragmentFirst, 'no header first: left as written');
});
