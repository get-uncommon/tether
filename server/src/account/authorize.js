/**
 * The login request to Shopify's Customer Account API authorize endpoint (OAuth 2.0 with PKCE and OpenID Connect). The
 * caller keeps its own pending login and cleans the visitor's locale and country before passing them in.
 */
import { toBase64Url } from '../base64url.js';

/** What a login asks for: the id token (`openid`), the email claim, and the whole Customer Account API. */
const LOGIN_SCOPE = 'openid email customer-account-api:full';

/**
 * @typedef {object} LoginRequest
 * @property {string} clientId The Customer Account API client id.
 * @property {string} redirectUri Where Shopify sends the visitor back with `?code=&state=`.
 * @property {string} state Ties the answer to this browser's pending login.
 * @property {string} nonce Comes back inside the id token.
 * @property {string} verifier The PKCE code verifier; only its S256 challenge is sent.
 * @property {string | undefined} [locale] The login page's language, already cleaned.
 * @property {string | undefined} [country] The login page's two-letter country, already cleaned.
 */

/**
 * The PKCE S256 challenge: base64url of the verifier's SHA-256 (RFC 7636 §4.2).
 *
 * @param {string} verifier
 * @returns {Promise<string>}
 */
async function codeChallenge(verifier) {
  return toBase64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

/**
 * The address of Shopify's login page for this request.
 *
 * @param {string} authorizationEndpoint From Shopify's OpenID discovery document.
 * @param {LoginRequest} login
 * @returns {Promise<string>}
 */
export async function authorizeUrl(authorizationEndpoint, login) {
  const url = new URL(authorizationEndpoint);
  /** @type {Record<string, string>} */
  const params = {
    client_id: login.clientId,
    scope: LOGIN_SCOPE,
    response_type: 'code',
    redirect_uri: login.redirectUri,
    state: login.state,
    nonce: login.nonce,
    code_challenge: await codeChallenge(login.verifier),
    code_challenge_method: 'S256',
  };
  if (login.locale) params['locale'] = login.locale;
  if (login.country) params['region_country'] = login.country;
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}
