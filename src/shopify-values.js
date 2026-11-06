/**
 * Conversions of Shopify values that the browser script and the server helpers (`src/server.js`, `src/astro.js`)
 * share, so a server-rendered page and the script that takes it over agree. Pure: no config, no DOM.
 */

/** @typedef {{ amount: string, currencyCode: string }} Money A Storefront API `MoneyV2`. */

/** The `.env` names a store's domain and public Storefront token are read from, first match wins. */
export const STORE_ENV_NAMES = {
  domain: ['PUBLIC_SHOPIFY_DOMAIN', 'PUBLIC_SHOPIFY_STORE_DOMAIN', 'SHOPIFY_DOMAIN'],
  token: ['PUBLIC_SHOPIFY_STOREFRONT_TOKEN', 'PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN', 'SHOPIFY_STOREFRONT_TOKEN'],
};

/**
 * Money as text in `locale`, e.g. `{ amount: '30.0', currencyCode: 'EUR' }` in `nl-NL` → `€ 30,00`.
 *
 * @param {Money | null | undefined} money
 * @param {string | undefined} locale An `Intl` locale; the runtime's own when absent.
 * @returns {string} `''` without money or with an amount that isn't a number.
 */
export function formatMoney(money, locale) {
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
 * @param {string} productPath
 * @param {string | null | undefined} handle
 * @param {string | null | undefined} [id] A product gid or numeric id.
 */
export function productUrl(productPath, handle, id) {
  if (!/\{(handle|id)\}/.test(productPath)) return `${productPath.replace(/\/$/, '')}/${handle ?? String(handle)}`;
  const numericId = id ? (id.split('/').pop() ?? '') : '';
  return productPath
    .replace(/\{handle\}/g, encodeURIComponent(handle ?? ''))
    .replace(/\{id\}/g, encodeURIComponent(numericId));
}

/**
 * The key Tether loads a product by: a handle, or a product gid.
 *
 * @param {string | number | null | undefined} raw A handle, a numeric id, a gid or a product URL (`…/products/<handle>`).
 * @returns {string | null}
 */
export function productKey(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.startsWith('gid://')) return value;
  if (/^\d+$/.test(value)) return `gid://shopify/Product/${value}`;
  return /\/products\/([^/?#]+)/.exec(value)?.[1] ?? value;
}
