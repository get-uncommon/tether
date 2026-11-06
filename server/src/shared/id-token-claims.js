/**
 * The claim checks of the id token Shopify returns at login (OpenID Connect Core, section 3.1.3.7), for the browser
 * and the Worker. They say nothing about who wrote the token: the Worker runs them after checking its signature, and
 * the browser on a token it received straight from Shopify's token endpoint.
 */
import { isRecord, textOrNull } from './json.js';

/** Clock difference allowed between Shopify and the checking side for `iat` and `nbf`. */
const CLOCK_SKEW_SECONDS = 300;

/**
 * What this login expects of the token.
 *
 * @typedef {object} ExpectedClaims
 * @property {string} issuer The `issuer` of Shopify's discovery document.
 * @property {string} clientId The Customer Account API client id.
 * @property {string} nonce The nonce this login sent.
 * @property {number} nowSeconds The current time, in seconds since the epoch.
 */

/** @typedef {{ kind: 'valid', subject: string } | { kind: 'invalid', reason: string }} ClaimsCheck */

/**
 * The `aud` claim as a list: a JWT carries one audience or several.
 *
 * @param {unknown} claim
 * @returns {unknown[]}
 */
function audiencesOf(claim) {
  return Array.isArray(claim) ? claim : [claim];
}

/**
 * The first claim that doesn't hold, or `null`.
 *
 * @param {Record<string, unknown>} claims
 * @param {ExpectedClaims} expected
 * @returns {string | null}
 */
function claimProblem(claims, { issuer, clientId, nonce, nowSeconds }) {
  const audiences = audiencesOf(claims['aud']);
  const { exp: expiresAt, iat: issuedAt, nbf: notBefore, azp: authorizedParty } = claims;
  if (claims['iss'] !== issuer) return 'issuer';
  if (!audiences.includes(clientId)) return 'audience';
  // With several audiences the token must name the party it was issued to; when it names one, that is this client.
  if (audiences.length > 1 && authorizedParty === undefined) return 'authorized party missing';
  if (authorizedParty !== undefined && authorizedParty !== clientId) return 'authorized party';
  if (claims['nonce'] !== nonce) return 'nonce';
  if (typeof expiresAt !== 'number' || !(expiresAt > nowSeconds)) return 'expired';
  if (typeof issuedAt !== 'number') return 'issued-at missing';
  if (issuedAt > nowSeconds + CLOCK_SKEW_SECONDS) return 'issued in the future';
  if (notBefore !== undefined && (typeof notBefore !== 'number' || notBefore > nowSeconds + CLOCK_SKEW_SECONDS)) {
    return 'not valid yet';
  }
  return null;
}

/**
 * Checks issuer, audience, authorized party, nonce, expiry, issue time, not-before and subject. Times must be JSON
 * numbers: a string `exp` is refused, never converted.
 *
 * @param {unknown} claims The token's decoded payload.
 * @param {ExpectedClaims} expected
 * @returns {ClaimsCheck} The customer's `sub` when every claim holds; else the first that doesn't, for the log.
 */
export function checkIdTokenClaims(claims, expected) {
  if (!isRecord(claims)) return { kind: 'invalid', reason: 'not a claims object' };
  const problem = claimProblem(claims, expected);
  if (problem) return { kind: 'invalid', reason: problem };
  const subject = textOrNull(claims['sub']);
  if (subject === null) return { kind: 'invalid', reason: 'subject missing' };
  return { kind: 'valid', subject };
}
