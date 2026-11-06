/**
 * The answers of Shopify's Customer Account API token endpoint, read the same way by the browser (browser mode) and
 * the Worker (server mode): a grant that worked, or why it was refused.
 */
import { field, textOrNull } from './json.js';

/**
 * A grant that worked.
 *
 * @typedef {object} TokenAnswer
 * @property {string} accessToken
 * @property {string | null} refreshToken `null` when Shopify issued none.
 * @property {string | null} idToken `null` when the answer has none (a refresh usually doesn't).
 * @property {number | null} expiresInSeconds `null` when Shopify left `expires_in` out or sent no positive number;
 *   each side then applies its own default.
 */

/**
 * Why the token endpoint refused a grant. `session-ended`: Shopify refused the grant itself (`invalid_grant`), so the
 * login code or refresh token is no longer valid and the customer has to log in again. `setup-error`: any other
 * refusal, such as `invalid_client` or a wrong `redirect_uri`, which is a mistake in the setup and must not log the
 * customer out.
 *
 * @typedef {{ kind: 'session-ended', code: 'invalid_grant' } | { kind: 'setup-error', code: string | null }} TokenRefusal
 */

/**
 * Shopify's `expires_in`, which arrives as a number or as a numeric string.
 *
 * @param {unknown} value
 * @returns {number | null} The seconds; `null` for anything that is not a positive finite number.
 */
export function expiresInSeconds(value) {
  const seconds = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * @param {unknown} body The token endpoint's JSON.
 * @returns {TokenAnswer | null} `null` when the answer carries no access token, which is a refusal.
 */
export function tokenAnswer(body) {
  const accessToken = textOrNull(field(body, 'access_token'));
  if (accessToken === null) return null;
  return {
    accessToken,
    refreshToken: textOrNull(field(body, 'refresh_token')),
    idToken: textOrNull(field(body, 'id_token')),
    expiresInSeconds: expiresInSeconds(field(body, 'expires_in')),
  };
}

/**
 * @param {unknown} body The JSON of a refused token request; anything else counts as a setup error.
 * @returns {TokenRefusal}
 */
export function tokenRefusal(body) {
  const code = textOrNull(field(body, 'error'));
  return code === 'invalid_grant' ? { kind: 'session-ended', code } : { kind: 'setup-error', code };
}
