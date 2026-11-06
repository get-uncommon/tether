/**
 * Shopify's Customer Account API endpoints for one shop, read from its two discovery documents, for the browser and
 * the Worker alike. Every endpoint must be https, because the tokens and the customer's data go there; an endpoint is
 * never guessed.
 */
import { field, textOrNull } from './json.js';

/** The OpenID Connect discovery document: issuer, authorize, token, logout and signing-key endpoints. */
export const OPENID_CONFIGURATION = 'openid-configuration';
/** Shopify's own discovery document: the Customer Account API's GraphQL endpoint. */
export const CUSTOMER_ACCOUNT_API = 'customer-account-api';

/** @typedef {typeof OPENID_CONFIGURATION | typeof CUSTOMER_ACCOUNT_API} DiscoveryDocument */

/**
 * @typedef {object} AccountEndpoints
 * @property {string} issuer The id token's `iss`.
 * @property {string} authorizationEndpoint
 * @property {string} tokenEndpoint
 * @property {string} endSessionEndpoint Shopify's logout.
 * @property {string} jwksUri The keys that sign the id token.
 * @property {string} graphql The Customer Account API GraphQL endpoint.
 */

/** A discovery document lacks an endpoint, or names one that is not https. */
export class DiscoveryError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

/**
 * @param {string} host The store domain, or Shopify's account host.
 * @param {DiscoveryDocument} document
 */
export function wellKnownUrl(host, document) {
  return `https://${host}/.well-known/${document}`;
}

/** @param {string} url */
function isHttpsUrl(url) {
  return URL.canParse(url) && new URL(url).protocol === 'https:';
}

/**
 * @param {string | null} url
 * @param {string} name The endpoint's name in its document, for the error.
 * @returns {string}
 * @throws {DiscoveryError}
 */
function httpsEndpoint(url, name) {
  if (url === null || !isHttpsUrl(url)) throw new DiscoveryError(`Shopify's account discovery has no https ${name}`);
  return url;
}

/**
 * The GraphQL endpoint in the `customer-account-api` document.
 *
 * @param {unknown} document The parsed JSON.
 * @throws {DiscoveryError}
 */
export function graphqlEndpoint(document) {
  return httpsEndpoint(textOrNull(field(document, 'graphql_api')), 'graphql_api');
}

/**
 * The endpoints from the `openid-configuration` document and the GraphQL endpoint.
 *
 * @param {unknown} openid The parsed JSON of the `openid-configuration` document.
 * @param {string} graphql From {@link graphqlEndpoint}, or the Worker's account-host address for the shop.
 * @returns {AccountEndpoints}
 * @throws {DiscoveryError}
 */
export function accountEndpoints(openid, graphql) {
  /** @param {string} name */
  const endpoint = (name) => httpsEndpoint(textOrNull(field(openid, name)), name);
  return {
    issuer: endpoint('issuer'),
    authorizationEndpoint: endpoint('authorization_endpoint'),
    tokenEndpoint: endpoint('token_endpoint'),
    endSessionEndpoint: endpoint('end_session_endpoint'),
    jwksUri: endpoint('jwks_uri'),
    graphql: httpsEndpoint(graphql, 'graphql_api'),
  };
}
