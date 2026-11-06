// The Storefront client's query text: what the market puts into @inContext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withContext } from '../src/client.js';

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
