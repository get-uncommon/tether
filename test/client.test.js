import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withContext, request, hasData, operationOf, shaped, TetherError } from '../src/client.ts';
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
  /** @type {string[]} */
  const queries = [];
  const conf = storefront('no-inventory.test', async (_url, init) => {
    const { query } = graphqlRequest(init);
    queries.push(query);
    if (query.includes('quantityAvailable')) {
      return jsonResponse({ errors: [{ message: 'Access denied for quantityAvailable field.' }] });
    }
    return jsonResponse({ data: { product: { id: '1' } } });
  });
  /** @type {boolean[]} */
  const accessSeen = [];
  /** @param {import('../src/client.ts').StoreAccess} access */
  const query = (access) => {
    accessSeen.push(access.inventory);
    return `query P { product(handle: "x") { id variants(first: 1) { nodes { id ${access.inventory ? 'quantityAvailable' : ''} } } } }`;
  };
  assert.deepEqual(await request(conf, query, {}, hasData, { context: false }), { product: { id: '1' } });
  assert.equal(queries.length, 2);
  assert.deepEqual(await request(conf, query, {}, hasData, { context: false }), { product: { id: '1' } });
  assert.equal(queries.length, 3, 'the second query goes out without the field at once');
  assert.doesNotMatch(queries[2] ?? '', /quantityAvailable/);
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
  /** @param {unknown} body */
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
  const error = await request(storefront('down.test', unauthorized), '{ shop { name } }', {}, hasData).catch(
    (failure) => failure,
  );
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
  /** @param {unknown} data */
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

/**
 * A store with one retry, whose fake answers each request with the next of `answers` and counts the requests.
 *
 * @param {(() => Response)[]} answers
 */
function answeringInTurn(answers) {
  const sent = { count: 0 };
  const conf = {
    ...resolveConfig({ domain: 'retry.test', token: 't', maxAge: 0, retries: 1 }),
    /** @type {typeof fetch} */
    fetch: async () => {
      const answer = answers[sent.count];
      sent.count += 1;
      assert.ok(answer, 'no more requests than answers');
      return answer();
    },
  };
  return { conf, sent };
}

const MUTATION = 'mutation Add($cartId: ID!) { cartLinesAdd(cartId: $cartId, lines: []) { cart { id } } }';
const gatewayTimeout = () => new Response('Gateway Timeout', { status: 504 });
const answered = () => jsonResponse({ data: { done: true } });

test('a mutation is not sent again after a 5xx or a network error, after which Shopify may already have applied it', async () => {
  const timedOut = answeringInTurn([gatewayTimeout, answered]);
  await assert.rejects(request(timedOut.conf, MUTATION, {}, hasData, { operation: 'mutation' }), {
    name: 'TetherError',
    code: 'HTTP_504',
    message: 'HTTP 504 from retry.test',
  });
  assert.equal(timedOut.sent.count, 1);

  const dropped = answeringInTurn([
    () => {
      throw new TypeError('fetch failed');
    },
    answered,
  ]);
  await assert.rejects(request(dropped.conf, MUTATION, {}, hasData, { operation: 'mutation' }), { code: 'NETWORK' });
  assert.equal(dropped.sent.count, 1);
});

test('a mutation is sent again after a 429 or THROTTLED, which Shopify answers without running it', async () => {
  const limited = answeringInTurn([() => jsonResponse({}, 429), answered]);
  assert.deepEqual(await request(limited.conf, MUTATION, {}, hasData, { operation: 'mutation' }), { done: true });
  assert.equal(limited.sent.count, 2);

  const throttled = answeringInTurn([
    () => jsonResponse({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }),
    answered,
  ]);
  assert.deepEqual(await request(throttled.conf, MUTATION, {}, hasData, { operation: 'mutation' }), { done: true });
  assert.equal(throttled.sent.count, 2);
});

test('a query is sent again after a 5xx', async () => {
  const { conf, sent } = answeringInTurn([gatewayTimeout, answered]);
  assert.deepEqual(await request(conf, '{ shop { name } }', {}, hasData), { done: true });
  assert.equal(sent.count, 2);
});

test("a document Tether didn't write is a mutation when it has the keyword outside strings and comments", async () => {
  assert.equal(operationOf(MUTATION), 'mutation');
  assert.equal(operationOf('fragment F on Cart { id }\nmutation M { cartCreate { cart { ...F } } }'), 'mutation');
  assert.equal(operationOf('# not a mutation\nquery Q($q: String = "mutation") { search(query: $q) { id } }'), 'query');
  assert.equal(operationOf('{ shop { name } }'), 'query');

  let sent = 0;
  const storefront = createStorefront({
    domain: 'shop.test',
    token: 't',
    retries: 1,
    fetch: async () => {
      sent += 1;
      return gatewayTimeout();
    },
  });
  await assert.rejects(storefront.query(MUTATION), { code: 'HTTP_504' });
  assert.equal(sent, 1, "the server's query() sends a mutation once");
});
