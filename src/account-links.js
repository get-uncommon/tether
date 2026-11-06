/** Order links and dates, shared by the account part's order list and the account pages. */
import { cfg } from './config.js';
import { isHttpsUrl } from './shopify-values.js';

export { isHttpsUrl };

/**
 * An ISO date in the configured locale; the input itself when it can't be formatted.
 *
 * @param {string} iso
 */
export function localDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(cfg.locale);
  } catch {
    return iso;
  }
}

/**
 * The order's page: the site's own (`account.orderUrl`, e.g. `/account/order?id={id}`, with the numeric order id),
 * else Shopify's status page when it is https.
 *
 * @param {{ id: string, statusPageUrl?: string | null }} order
 * @returns {string | null}
 */
export function orderUrl(order) {
  const template = cfg.account?.orderUrl;
  if (template) {
    const numericId = order.id.split('/').pop()?.split('?')[0] ?? '';
    return template.replace('{id}', encodeURIComponent(numericId));
  }
  return isHttpsUrl(order.statusPageUrl) ? (order.statusPageUrl ?? null) : null;
}
