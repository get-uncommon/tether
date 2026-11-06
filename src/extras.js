/**
 * Optional part with features that load when first needed: bundles (on the first "add set" click), tab sync (on the
 * first change in another tab) and shareable variant links (on the first variant change, with `variantUrl` or
 * `tether-variant-url`).
 */
import { cfg, warn, reportError } from './config.js';
import { sel, get, has, qsa, emit, parseJSONAttr, attributesFromJson } from './dom.js';
import { scopes } from './product.js';
import { Cart } from './cart.js';
import { isRecord } from '../server/src/shared/json.js';
/** @import { ShopifyCart } from './cart/store.js' */

/** @typedef {{ country: string, language: string | null, locale: string | undefined }} StoredMarket */
/**
 * @typedef {(country: string, options: { language: string | null, locale: string | undefined, remember: boolean })
 *   => Promise<unknown>} SetCountry
 */

/**
 * @param {Element} group
 * @param {string | null} name The group's `tether-group` value.
 */
function groupAttributes(group, name) {
  const extra = attributesFromJson(parseJSONAttr(group, 'line-attributes'));
  return name ? [{ key: '_group', value: name }, ...extra] : extra;
}

/**
 * `[tether-group]` with `[tether-group-add]`: adds every product scope inside the group in one request, for bundles,
 * build-a-box and "complete the set". The lines get the attribute `_group` and the group's `tether-line-attributes`.
 *
 * @param {Element} button
 * @returns {Promise<ShopifyCart | null>} The cart, `null` with nothing to add or after a reported failure.
 */
export async function addGroup(button) {
  const group = button.closest(sel('group'));
  if (!group) return null;
  const name = get(group, 'group');
  const attributes = groupAttributes(group, name);
  const lines = qsa(group, sel('product')).flatMap((el) => {
    const scope = scopes.get(el);
    if (!scope?.variant?.availableForSale || scope.quantity <= 0) return [];
    const line = scope.getLine();
    return line ? [{ ...line, attributes: [...(line.attributes ?? []), ...attributes] }] : [];
  });
  if (!lines.length) {
    warn('group-add: nothing selected');
    return null;
  }
  try {
    const cart = await Cart.add(lines);
    emit('group-added', { group: name, lines }, group);
    return cart;
  } catch (error) {
    reportError(error, 'group add');
    return null;
  }
}

/**
 * Another tab writes the market as JSON; a value that isn't (written by something else under the key) is skipped.
 *
 * @param {string} text
 * @returns {StoredMarket | null}
 */
function parseStoredMarket(text) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { country, language, locale } = value;
  if (typeof country !== 'string' || !country) return null;
  return {
    country,
    language: typeof language === 'string' ? language : null,
    locale: typeof locale === 'string' ? locale : undefined,
  };
}

/**
 * Another tab changed the cart (it is loaded again here) or the visitor's market (this tab follows it).
 *
 * @param {StorageEvent} event
 */
export function onStorage(event) {
  if (event.key === cfg.storageKey || event.key === `${cfg.storageKey}:seen`) {
    Cart.init().catch((/** @type {unknown} */ error) => {
      reportError(error, 'cart from another tab');
    });
    return;
  }
  if (event.key !== `${cfg.prefix}:market:${cfg.domain}` || !event.newValue) return;
  const market = parseStoredMarket(event.newValue);
  const { Tether } = /** @type {Window & { Tether?: { setCountry: SetCountry } }} */ (window);
  if (!market || !Tether) return;
  const options = { language: market.language, locale: market.locale, remember: false };
  Tether.setCountry(market.country, options).catch((/** @type {unknown} */ error) => {
    reportError(error, 'market from another tab');
  });
}

/** @type {WeakMap<Element, string>} Scope root → its last variant and plan, so the first render doesn't write. */
const urlKeys = new WeakMap();

/** @param {string} gid */
const numericId = (gid) => gid.split('/').pop() ?? gid;

/**
 * Safari throws a SecurityError past 100 history changes in 10 seconds; the address then keeps the previous choice
 * until the next one.
 *
 * @param {URL} url
 */
function replaceUrlIfAllowed(url) {
  try {
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // Too many changes in a row: see the function's comment.
  }
}

/**
 * `?variant=` (and `selling_plan=`) follow the visitor's choice.
 *
 * @param {Element} root The product scope's root.
 * @param {{ variant: { id: string }, sellingPlanId: string | null | undefined }} choice
 */
export function writeVariantUrl(root, { variant, sellingPlanId }) {
  const key = `${variant.id}|${sellingPlanId ?? ''}`;
  const before = urlKeys.get(root);
  urlKeys.set(root, key);
  if (!before || before === key) return;
  const isMainProduct = cfg.variantUrl && document.querySelector(sel('product')) === root;
  if (!has(root, 'variant-url') && !isMainProduct) return;
  const url = new URL(window.location.href);
  url.searchParams.set('variant', numericId(variant.id));
  if (sellingPlanId) url.searchParams.set('selling_plan', numericId(sellingPlanId));
  else url.searchParams.delete('selling_plan');
  replaceUrlIfAllowed(url);
}
