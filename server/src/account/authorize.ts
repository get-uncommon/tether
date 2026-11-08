/**
 * The login request to Shopify's Customer Account API authorize endpoint (OAuth 2.0 with PKCE and OpenID Connect). The
 * caller keeps its own pending login and parses the visitor's language and country before passing them in.
 */
import { toBase64Url } from '../base64url.ts';
import { sha256 } from '../crypto.ts';
import type { CountryCode, LanguageCode } from '../shared/market-codes.ts';

/** What a login asks for: the id token (`openid`), the email claim, and the whole Customer Account API. */
const LOGIN_SCOPE = 'openid email customer-account-api:full';

interface LoginRequest {
  /** The Customer Account API client id. */
  clientId: string;
  /** Where Shopify sends the visitor back with `?code=&state=`. */
  redirectUri: string;
  /** Ties the answer to this browser's pending login. */
  state: string;
  /** Comes back inside the id token. */
  nonce: string;
  /** The PKCE code verifier; only its S256 challenge is sent. */
  verifier: string;
  /** The login page's language. */
  language: LanguageCode | null;
  /** The login page's country. */
  country: CountryCode | null;
}

/** The `locale` Shopify's login page takes: a language tag, `PT_BR` → `pt-BR`, `DE` → `de`. */
function localeTag(language: LanguageCode): string {
  const [primary = '', region] = language.split('_');
  return region === undefined ? primary.toLowerCase() : `${primary.toLowerCase()}-${region}`;
}

/** The PKCE S256 challenge: base64url of the verifier's SHA-256 (RFC 7636 §4.2). */
async function codeChallenge(verifier: string): Promise<string> {
  return toBase64Url(await sha256(verifier));
}

/**
 * The address of Shopify's login page for this request.
 *
 * @param authorizationEndpoint From Shopify's OpenID discovery document.
 */
export async function authorizeUrl(authorizationEndpoint: string, login: LoginRequest): Promise<string> {
  const url = new URL(authorizationEndpoint);
  const params: Record<string, string> = {
    client_id: login.clientId,
    scope: LOGIN_SCOPE,
    response_type: 'code',
    redirect_uri: login.redirectUri,
    state: login.state,
    nonce: login.nonce,
    code_challenge: await codeChallenge(login.verifier),
    code_challenge_method: 'S256',
  };
  if (login.language) params['locale'] = localeTag(login.language);
  if (login.country) params['region_country'] = login.country;
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}
