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
export const STORE_ENV_NAMES = {
  domain: ['PUBLIC_SHOPIFY_DOMAIN', 'PUBLIC_SHOPIFY_STORE_DOMAIN', 'SHOPIFY_DOMAIN'],
  token: ['PUBLIC_SHOPIFY_STOREFRONT_TOKEN', 'PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN', 'SHOPIFY_STOREFRONT_TOKEN'],
} as const;

/**
 * True for an absolute https URL. Links and redirects that come from Shopify (checkout, status pages,
 * tracking) are only used when this holds.
 */
export function isHttpsUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    // Not an absolute URL, so not an https one.
    return false;
  }
}

/**
 * True for a token Shopify issues as a secret (`shpat_` Admin, `shpss_` shared secret, `shpca_` client credentials,
 * `shppa_` private app, `shpua_` user). The public Storefront token has no such prefix. A secret token must never
 * reach a page.
 */
export function isSecretShopifyToken(token: string): boolean {
  return /^shp[a-z]{2}_/.test(token.trim());
}

/**
 * Money as text in `locale`, e.g. `{ amount: '30.0', currencyCode: 'EUR' }` in `nl-NL` → `€ 30,00`.
 *
 * @param locale An `Intl` locale; the runtime's own when absent.
 * @returns `''` without money or with an amount that isn't a number.
 */
export function formatMoney(money: Money | null | undefined, locale: string | undefined): string {
  if (!money) return '';
  const amount = parseFloat(money.amount);
  if (Number.isNaN(amount)) return '';
  try {
    return new Intl.NumberFormat(locale || undefined, { style: 'currency', currency: money.currencyCode }).format(
      amount,
    );
  } catch {
    // A currency code Intl doesn't know.
    return `${money.currencyCode} ${amount.toFixed(2)}`;
  }
}

/**
 * A product page's path. `productPath` is a folder (`/product` → `/product/<handle>`) or a template with `{handle}`
 * and `{id}` (the numeric product id), e.g. `/product?handle={handle}`.
 *
 * @param id A product gid or numeric id.
 * @returns `null` when the path needs a handle or an id the product lacks: no link beats a wrong one.
 */
export function productUrl(productPath: string, handle: string | null | undefined, id?: string | null): string | null {
  if (!/\{(handle|id)\}/.test(productPath)) {
    return handle ? `${productPath.replace(/\/$/, '')}/${encodeURIComponent(handle)}` : null;
  }
  const numericId = id ? (id.split('/').at(-1) ?? '') : '';
  if (productPath.includes('{handle}') && !handle) return null;
  if (productPath.includes('{id}') && !numericId) return null;
  return productPath
    .replace(/\{handle\}/g, encodeURIComponent(handle ?? ''))
    .replace(/\{id\}/g, encodeURIComponent(numericId));
}

/**
 * The key Tether loads a product by: a handle, or a product gid.
 *
 * @param raw A handle, a numeric id, a gid or a product URL (`…/products/<handle>`).
 */
export function productKey(raw: string | number | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.startsWith('gid://')) return value;
  if (/^\d+$/.test(value)) return `gid://shopify/Product/${value}`;
  return /\/products\/([^/?#]+)/.exec(value)?.[1] ?? value;
}
