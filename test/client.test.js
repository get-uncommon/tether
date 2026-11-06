import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withContext, request, hasData, shaped, TetherError } from '../src/client.ts';
import { resolveConfig } from '../src/config.ts';
import { createStorefront } from '../src/server.ts';
import { graphqlRequest, jsonResponse, product } from './fixtures.js';

/**
 * A store's settings for `request`, with no cache and no retries.
 *
 * @param {string} domain
 * @param {typeof fetch} [fetch]
 * @returns {import('../src/client.ts').StorefrontConfig}
 */
const storefront = (domain, fetch) => ({
  ...resolveConfig({ domain, token: 't', maxAge: 0, retries: 0 }),
  ...(fetch ? { fetch } : {}),
});

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
  const conf = storefront('no-inventory.test', async (_url, init) => {
    const { query } = graphqlRequest(init);
    queries.push(query);
    if (query.includes('quantityAvailable')) {
      return jsonResponse({ errors: [{ message: 'Access denied for quantityAvailable field.' }] });
    }
    return jsonResponse({ data: { product: { id: '1' } } });
  });
  const accessSeen = [];
  const query = (access) => {
    accessSeen.push(access.inventory);
    return `query P { product(handle: "x") { id variants(first: 1) { nodes { id ${access.inventory ? 'quantityAvailable' : ''} } } } }`;
  };
  assert.deepEqual(await request(conf, query, {}, hasData, { context: false }), { product: { id: '1' } });
  assert.equal(queries.length, 2);
  assert.deepEqual(await request(conf, query, {}, hasData, { context: false }), { product: { id: '1' } });
  assert.equal(queries.length, 3, 'the second query goes out without the field at once');
  assert.doesNotMatch(queries[2], /quantityAvailable/);
  assert.deepEqual(accessSeen, [true, false, false]);

  const ownQuery = 'query Own { product(handle: "x") { variants(first: 1) { nodes { quantityAvailable } } } }';
  await assert.rejects(request(conf, ownQuery, {}, hasData, { context: false }), {
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
  const answering = (body) => storefront('odd.test', async () => jsonResponse(body));
  await assert.rejects(request(answering({ errors: 'boom' }), '{ shop { name } }', {}, hasData), {
    name: 'TetherError',
    message: 'Invalid response (200)',
  });
  await assert.rejects(request(answering([1, 2]), '{ shop { name } }', {}, hasData), { name: 'TetherError' });
  await assert.rejects(
    request(answering({ errors: [{ code: 1 }, null, { message: 'Field missing' }] }), '{ x }', {}, hasData),
    {
      name: 'TetherError',
      message: 'Field missing',
    },
  );
  await assert.rejects(request(answering({ errors: [{ extensions: { code: 7 } }] }), '{ x }', {}, hasData), {
    name: 'TetherError',
    message: 'Storefront API error',
  });
});

test('request errors are TetherErrors with a code', async () => {
  await assert.rejects(request(storefront(''), '{ shop { name } }', {}, hasData), {
    name: 'TetherError',
    code: 'NOT_CONFIGURED',
  });
  const offline = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(request(storefront('down.test', offline), '{ shop { name } }', {}, hasData), {
    code: 'NETWORK',
  });
  const unauthorized = async () => jsonResponse({}, 401);
  const error = await request(storefront('down.test', unauthorized), '{ shop { name } }', {}, hasData).catch((e) => e);
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

test('an answer whose data lacks what the caller reads is refused like any other malformed answer', async () => {
  const conf = storefront('odd.test', async () => jsonResponse({ data: { shop: null } }));
  await assert.rejects(request(conf, '{ shop { name } }', {}, shaped({ shop: { name: 'string' } })), {
    name: 'TetherError',
    code: 'HTTP_200',
    message: 'Invalid response (200)',
  });
  await assert.rejects(
    request(
      storefront('odd.test', async () => jsonResponse({})),
      '{ shop { name } }',
      {},
      hasData,
    ),
    { message: 'Invalid response (200)' },
  );
});

test('the server catalog refuses a product missing fields, and reads a node of another type as no product', async () => {
  const answering = (data) =>
    createStorefront({ domain: 'shop.test', token: 't', retries: 0, fetch: async () => jsonResponse({ data }) });
  const invalid = { name: 'TetherError', message: 'Invalid response (200)' };
  const gid = 'gid://shopify/Product/1';
  assert.equal(await answering({ node: {} }).getProduct(gid), null);
  assert.equal((await answering({ node: product }).getProduct(gid))?.handle, product.handle);
  await assert.rejects(answering({ node: { id: gid } }).getProduct(gid), invalid);
  await assert.rejects(answering({ product: { ...product, priceRange: null } }).getProduct('coffee-box'), invalid);
  await assert.rejects(answering({ products: { nodes: [product] } }).getProducts(), invalid, 'no pageInfo');
  await assert.rejects(answering({ productRecommendations: [{ id: gid }] }).getRecommendations(gid), invalid);
});
