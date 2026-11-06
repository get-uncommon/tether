/**
 * Country and language codes as Shopify's `@inContext` takes them, parsed by the module the Worker uses for the
 * login's market, so the browser and the Worker accept and refuse the same values.
 */
export { toCountry, toLanguage } from '../server/src/shared/market-codes.js';
export type { CountryCode, LanguageCode } from '../server/src/shared/market-codes.js';
