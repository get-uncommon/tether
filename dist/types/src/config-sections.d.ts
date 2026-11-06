import type { AccountConfig, AnalyticsConfig, MarketsConfig, MetafieldIdentifier, MetafieldRef } from './config.js';
/** Warns that an option was dropped. */
type Invalid = (name: string, value: unknown) => void;
/** A host name, without protocol or path: what `domainOption` keeps of the `domain` option. */
export type ShopDomain = string & {
    readonly __brand: 'ShopDomain';
};
/** Every source `markets.detect` reads. */
export declare const MARKET_SOURCES: readonly ('saved' | 'server' | 'webflow')[];
/**
 * @returns The store's domain without protocol or path (`https://shop.example/x` → `shop.example`), `''` for anything
 *   that isn't a host name.
 */
export declare function domainOption(value: unknown, invalid: Invalid): ShopDomain | '';
/**
 * The folder of the optional parts. It must be https or on this site, which keeps parts off plain http (mixed content,
 * rewritable on the way); it doesn't vouch for the host, which the site chose.
 *
 * @returns The folder as written, `null` for none or one elsewhere (the parts then load beside the core).
 */
export declare function partsUrlOption(value: unknown, invalid: Invalid): string | null;
/**
 * The origins a site lets description iframes load from. Each one is trusted to show only what the site expects in a
 * description, so only a bare https origin is taken: a path would suggest a narrower trust than is given.
 *
 * @returns The valid origins; each other entry is skipped with a warning.
 */
export declare function embedOriginsOption(value: unknown, invalid: Invalid): string[];
/** @returns The identifier of `'namespace.key'` or `{ namespace, key }`, when both parts are valid identifiers. */
export declare function toMetafieldIdentifier(ref: unknown): MetafieldIdentifier | null;
/** @returns The refs that name a valid identifier, as written; each other one is skipped with a warning. */
export declare function metafieldsOption(value: unknown, invalid: Invalid): MetafieldRef[];
/**
 * @param warn Says why an `account` without a usable `server` is off.
 * @returns `null` without a usable `account.server`: nothing of the account part loads.
 */
export declare function accountOption(value: unknown, invalid: Invalid, warn: (message: string) => void): AccountConfig | null;
export declare const marketsOption: (value: unknown, invalid: Invalid) => MarketsConfig | null;
export declare const analyticsOption: (value: unknown, invalid: Invalid) => AnalyticsConfig | null;
export {};
