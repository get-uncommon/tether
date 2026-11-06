/**
 * Conversions of Shopify values that the browser script and the server helpers (`src/server.ts`, `src/astro.ts`)
 * share, so a server-rendered page and the script that takes it over agree. Pure: no config, no DOM.
 */
/** A Storefront API `MoneyV2`. */
export interface Money {
    amount: string;
    currencyCode: string;
}
/** The `.env` names a store's domain and public Storefront token are read from, first match wins. */
export declare const STORE_ENV_NAMES: {
    readonly domain: readonly ["PUBLIC_SHOPIFY_DOMAIN", "PUBLIC_SHOPIFY_STORE_DOMAIN", "SHOPIFY_DOMAIN"];
    readonly token: readonly ["PUBLIC_SHOPIFY_STOREFRONT_TOKEN", "PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN", "SHOPIFY_STOREFRONT_TOKEN"];
};
/**
 * True for an absolute https URL. Links and redirects that come from Shopify (checkout, status pages,
 * tracking) are only used when this holds.
 */
export declare function isHttpsUrl(url: unknown): url is string;
/**
 * True for a token Shopify issues as a secret (`shpat_` Admin, `shpss_` shared secret, `shpca_` client credentials,
 * `shppa_` private app, `shpua_` user). The public Storefront token has no such prefix. A secret token must never
 * reach a page.
 */
export declare function isSecretShopifyToken(token: string): boolean;
/**
 * Money as text in `locale`, e.g. `{ amount: '30.0', currencyCode: 'EUR' }` in `nl-NL` → `€ 30,00`.
 *
 * @param locale An `Intl` locale; the runtime's own when absent.
 * @returns `''` without money or with an amount that isn't a number.
 */
export declare function formatMoney(money: Money | null | undefined, locale: string | undefined): string;
/**
 * A product page's path. `productPath` is a folder (`/product` → `/product/<handle>`) or a template with `{handle}`
 * and `{id}` (the numeric product id), e.g. `/product?handle={handle}`.
 *
 * @param id A product gid or numeric id.
 * @returns `null` when the path needs a handle or an id the product lacks: no link beats a wrong one.
 */
export declare function productUrl(productPath: string, handle: string | null | undefined, id?: string | null): string | null;
/**
 * The key Tether loads a product by: a handle, or a product gid.
 *
 * @param raw A handle, a numeric id, a gid or a product URL (`…/products/<handle>`).
 */
export declare function productKey(raw: string | number | null | undefined): string | null;
