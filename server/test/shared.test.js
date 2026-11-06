// The JSON helpers and the order reader in server/src/shared/, and the parsers of Shopify's login answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asList, textOrNull } from '../src/shared/json.ts';
import { readOrders } from '../src/shared/account-orders.ts';
import { expiresInSeconds, tokenAnswer, tokenRefusal } from '../src/account/token-answer.ts';
import { accountEndpoints, DiscoveryError, graphqlEndpoint, wellKnownUrl } from '../src/account/discovery.ts';
import { checkIdTokenClaims } from '../src/account/id-token-claims.ts';

test('textOrNull: a non-empty string, else null; asList: an array, else empty', () => {
  assert.deepEqual(['a', '', null, 3, undefined].map(textOrNull), ['a', null, null, null, null]);
  assert.deepEqual(asList([1]), [1]);
  assert.deepEqual(asList({ 0: 1 }), []);
});

test('readOrders: the fields the orders document selects, null when missing; an order without an id is refused', () => {
  const reading = readOrders([
    {
      id: 'gid://shopify/Order/1',
      name: '#1',
      extra: 'dropped',
      totalPrice: { amount: '5.0' },
      lineItems: { nodes: [{ title: 'Tee', quantity: 2, image: { url: 'https://cdn.shopify.com/t.jpg' } }] },
    },
  ]);
  assert.deepEqual(reading, {
    kind: 'read',
    orders: [
      {
        id: 'gid://shopify/Order/1',
        name: '#1',
        processedAt: null,
        financialStatus: null,
        fulfillmentStatus: null,
        statusPageUrl: null,
        totalPrice: null,
        lineItems: {
          nodes: [
            {
              title: 'Tee',
              variantTitle: null,
              quantity: 2,
              image: { url: 'https://cdn.shopify.com/t.jpg', altText: null },
            },
          ],
        },
      },
    ],
  });
  assert.deepEqual(readOrders('not a list'), { kind: 'read', orders: [] });
  assert.deepEqual(readOrders([{ name: '#2' }]), { kind: 'missing-id' });
});

test('token answers: expires_in as a number or numeric string, refusals by their error code', () => {
  assert.deepEqual([3600, '3600', ' ', '', 'abc', 0, -1, Infinity, null].map(expiresInSeconds), [
    3600,
    3600,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  assert.deepEqual(tokenAnswer({ access_token: 'a', refresh_token: '', id_token: 7, expires_in: '60' }), {
    accessToken: 'a',
    refreshToken: null,
    idToken: null,
    expiresInSeconds: 60,
  });
  assert.equal(tokenAnswer({ access_token: '' }), null);
  assert.deepEqual(tokenRefusal({ error: 'invalid_grant' }), { kind: 'session-ended', code: 'invalid_grant' });
  assert.deepEqual(tokenRefusal({ error: 'invalid_client' }), { kind: 'setup-error', code: 'invalid_client' });
  assert.deepEqual(tokenRefusal('<html>'), { kind: 'setup-error', code: null });
});

test('discovery: every endpoint is https, none is guessed', () => {
  const openid = {
    issuer: 'https://shopify.com/authentication/1',
    authorization_endpoint: 'https://shopify.com/authentication/1/oauth/authorize',
    token_endpoint: 'https://shopify.com/authentication/1/oauth/token',
    end_session_endpoint: 'https://shopify.com/authentication/1/logout',
    jwks_uri: 'https://shopify.com/authentication/1/.well-known/jwks.json',
  };
  const graphql = graphqlEndpoint({ graphql_api: 'https://shopify.com/1/account/customer/api/2026-07/graphql' });
  assert.equal(accountEndpoints(openid, graphql).endSessionEndpoint, openid.end_session_endpoint);
  assert.throws(
    () => accountEndpoints({ ...openid, end_session_endpoint: 'http://evil.example/logout' }, graphql),
    DiscoveryError,
  );
  assert.throws(() => accountEndpoints({ ...openid, jwks_uri: undefined }, graphql), /jwks_uri/);
  assert.throws(() => graphqlEndpoint({}), /graphql_api/);
  assert.equal(
    wellKnownUrl('shop.myshopify.com', 'openid-configuration'),
    'https://shop.myshopify.com/.well-known/openid-configuration',
  );
});

test('id token claims: each check, with the first that fails named', () => {
  const nowSeconds = 1_800_000_000;
  const expected = { issuer: 'https://shopify.com/authentication/1', clientId: 'client-1', nonce: 'n', nowSeconds };
  const good = { iss: expected.issuer, aud: 'client-1', nonce: 'n', exp: nowSeconds + 60, iat: nowSeconds, sub: 's' };
  assert.deepEqual(checkIdTokenClaims(good, expected), { kind: 'valid', subject: 's' });
  /** @param {Record<string, unknown>} claims */
  const reason = (claims) => {
    const check = checkIdTokenClaims({ ...good, ...claims }, expected);
    return check.kind === 'invalid' ? check.reason : null;
  };
  assert.equal(reason({ iss: 'https://other' }), 'issuer');
  assert.equal(reason({ aud: ['other'] }), 'audience');
  assert.equal(reason({ aud: ['client-1', 'other'] }), 'authorized party missing');
  assert.equal(reason({ aud: ['client-1', 'other'], azp: 'other' }), 'authorized party');
  assert.equal(reason({ aud: ['client-1', 'other'], azp: 'client-1' }), null);
  assert.equal(reason({ nonce: 'm' }), 'nonce');
  assert.equal(reason({ exp: String(nowSeconds + 60) }), 'expired');
  assert.equal(reason({ exp: nowSeconds }), 'expired');
  assert.equal(reason({ iat: undefined }), 'issued-at missing');
  assert.equal(reason({ iat: nowSeconds + 301 }), 'issued in the future');
  assert.equal(reason({ iat: nowSeconds + 299 }), null, 'clock skew');
  assert.equal(reason({ nbf: nowSeconds + 301 }), 'not valid yet');
  assert.equal(reason({ nbf: 'soon' }), 'not valid yet');
  assert.equal(reason({ sub: '' }), 'subject missing');
  assert.deepEqual(checkIdTokenClaims(null, expected), { kind: 'invalid', reason: 'not a claims object' });
});
