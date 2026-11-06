/**
 * Verifying the id token Shopify's token endpoint returns at login: its RS256 signature against the shop's published
 * signing keys, then its claims. The Worker trusts nothing in the token before the signature holds.
 */

/** @import { ShopifyAccountSettings } from './settings.js' */
/** @import { Discovery, Fetch } from './shopify.js' */

import { fromBase64Url } from '../shared/base64url.js';
import { checkIdTokenClaims } from './id-token-claims.js';
import { asList, field } from '../shared/json.js';
import { asRecord, responseJsonOrNull } from '../json.js';
import { JSON_HEADERS } from './shopify.js';

/** @typedef {{ kid: string, jwk: JsonWebKey }} SigningKey An RSA key from Shopify's key set, by its key id. */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** How long Shopify's signing keys are trusted before they are fetched again. */
const JWKS_TTL_MS = 3600e3;

/** @type {Map<string, { keys: SigningKey[], until: number }>} */
const jwksCache = new Map();

/**
 * @param {string} part
 * @returns {Record<string, unknown>}
 */
function jwtPart(part) {
  /** @type {unknown} */
  const json = JSON.parse(decoder.decode(fromBase64Url(part)));
  return asRecord(json);
}

/**
 * One entry of Shopify's key set, when it is an RSA public key with a key id; the others can't verify an RS256 token.
 *
 * @param {unknown} value
 * @returns {SigningKey | null}
 */
function signingKeyOf(value) {
  const kid = field(value, 'kid');
  const modulus = field(value, 'n');
  const exponent = field(value, 'e');
  if (field(value, 'kty') !== 'RSA' || typeof kid !== 'string' || !kid) return null;
  if (typeof modulus !== 'string' || typeof exponent !== 'string') return null;
  return { kid, jwk: { kty: 'RSA', n: modulus, e: exponent } };
}

/**
 * Shopify's signing keys, fetched again after {@link JWKS_TTL_MS} or when a token names a key they don't have.
 *
 * @param {string} jwksUri
 * @param {string} kid
 * @param {Fetch} fetchImpl
 * @returns {Promise<SigningKey[]>}
 */
async function signingKeys(jwksUri, kid, fetchImpl) {
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.until > Date.now() && cached.keys.some((key) => key.kid === kid)) return cached.keys;
  const response = await fetchImpl(jwksUri, { headers: JSON_HEADERS });
  const entries = response.ok ? field(await responseJsonOrNull(response), 'keys') : undefined;
  if (!Array.isArray(entries)) {
    const type = response.headers.get('content-type') ?? 'no type';
    throw new Error(`Shopify's signing keys answered ${response.status} (${type})`);
  }
  const keys = asList(entries).flatMap((entry) => signingKeyOf(entry) ?? []);
  jwksCache.set(jwksUri, { keys, until: Date.now() + JWKS_TTL_MS });
  return keys;
}

/**
 * Checks the id token's RS256 signature against Shopify's published key with the token's `kid`, and only then its
 * claims (`checkIdTokenClaims`).
 *
 * @param {string} token
 * @param {Discovery} discovery
 * @param {ShopifyAccountSettings} settings
 * @param {string} nonce The nonce sent with this login.
 * @param {Fetch} fetchImpl
 * @returns {Promise<string>} The customer's `sub`.
 * @throws {Error} When the signature or a claim doesn't hold.
 */
export async function verifyIdToken(token, discovery, settings, nonce, fetchImpl) {
  const [headerPart, payloadPart, signature] = token.split('.');
  if (!headerPart || !payloadPart || !signature) throw new Error('id token missing');
  const header = jwtPart(headerPart);
  if (header['alg'] !== 'RS256') throw new Error(`id token alg ${String(header['alg'])}`);
  const kid = header['kid'];
  if (typeof kid !== 'string' || !kid) throw new Error('id token has no key id');
  const signingKey = (await signingKeys(discovery.jwksUri, kid, fetchImpl)).find((key) => key.kid === kid);
  if (!signingKey) throw new Error('id token key not found');
  const key = await crypto.subtle.importKey(
    'jwk',
    signingKey.jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = encoder.encode(`${headerPart}.${payloadPart}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64Url(signature), signed))) {
    throw new Error('id token signature');
  }
  const check = checkIdTokenClaims(jwtPart(payloadPart), {
    issuer: discovery.issuer,
    clientId: settings.clientId,
    nonce,
    nowSeconds: Date.now() / 1000,
  });
  if (check.kind === 'invalid') throw new Error(`id token ${check.reason}`);
  return check.subject;
}
