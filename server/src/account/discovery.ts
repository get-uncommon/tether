/**
 * Shopify's Customer Account API endpoints for one shop, read from its two discovery documents. Every endpoint must
 * be https, because the tokens and the customer's data go there; an endpoint is never guessed.
 */
import { field, textOrNull } from '../shared/json.ts';

/** The OpenID Connect discovery document: issuer, authorize, token, logout and signing-key endpoints. */
export const OPENID_CONFIGURATION = 'openid-configuration';
/** Shopify's own discovery document: the Customer Account API's GraphQL endpoint. */
export const CUSTOMER_ACCOUNT_API = 'customer-account-api';

type DiscoveryDocument = typeof OPENID_CONFIGURATION | typeof CUSTOMER_ACCOUNT_API;

export interface AccountEndpoints {
  /** The id token's `iss`. */
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Shopify's logout. */
  endSessionEndpoint: string;
  /** The keys that sign the id token. */
  jwksUri: string;
  /** The Customer Account API GraphQL endpoint. */
  graphql: string;
}

/** A discovery document lacks an endpoint, or names one that is not https. */
export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

/**
 * @param host The store domain, or Shopify's account host.
 */
export function wellKnownUrl(host: string, document: DiscoveryDocument): string {
  return `https://${host}/.well-known/${document}`;
}

function isHttpsUrl(url: string): boolean {
  return URL.canParse(url) && new URL(url).protocol === 'https:';
}

/**
 * @param name The endpoint's name in its document, for the error.
 * @throws {DiscoveryError}
 */
function httpsEndpoint(url: string | null, name: string): string {
  if (url === null || !isHttpsUrl(url)) throw new DiscoveryError(`Shopify's account discovery has no https ${name}`);
  return url;
}

/**
 * The GraphQL endpoint in the `customer-account-api` document.
 *
 * @param document The parsed JSON.
 * @throws {DiscoveryError}
 */
export function graphqlEndpoint(document: unknown): string {
  return httpsEndpoint(textOrNull(field(document, 'graphql_api')), 'graphql_api');
}

/**
 * The endpoints from the `openid-configuration` document and the GraphQL endpoint.
 *
 * @param openid The parsed JSON of the `openid-configuration` document.
 * @param graphql From {@link graphqlEndpoint}, or the Worker's account-host address for the shop.
 * @throws {DiscoveryError}
 */
export function accountEndpoints(openid: unknown, graphql: string): AccountEndpoints {
  const endpoint = (name: string): string => httpsEndpoint(textOrNull(field(openid, name)), name);
  return {
    issuer: endpoint('issuer'),
    authorizationEndpoint: endpoint('authorization_endpoint'),
    tokenEndpoint: endpoint('token_endpoint'),
    endSessionEndpoint: endpoint('end_session_endpoint'),
    jwksUri: endpoint('jwks_uri'),
    graphql: httpsEndpoint(graphql, 'graphql_api'),
  };
}
