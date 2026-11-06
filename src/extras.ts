/**
 * Optional part with features that load when first needed: bundles (on the first "add set" click), tab sync (on the
 * first change in another tab) and shareable variant links (on the first variant change, with `variantUrl` or
 * `tether-variant-url`).
 */
import { cfg, warn, reportError } from './config.ts';
import { sel, get, has, qsa, emit, parseJSONAttr, attributesFromJson } from './dom.ts';
import { scopes } from './product.ts';
import { Cart } from './cart.ts';
import { setCountry } from './page-market.ts';
import { parseSavedMarket, storageKey as marketStorageKey } from './markets.ts';
import type { ShopifyCart } from './cart/store.ts';

/** @param name The group's `tether-group` value. */
function groupAttributes(group: Element, name: string | null) {
  const extra = attributesFromJson(parseJSONAttr(group, 'line-attributes'));
  return name ? [{ key: '_group', value: name }, ...extra] : extra;
}

/**
 * `[tether-group]` with `[tether-group-add]`: adds every product scope inside the group in one request, for bundles,
 * build-a-box and "complete the set". The lines get the attribute `_group` and the group's `tether-line-attributes`.
 *
 * @returns The cart, `null` with nothing to add or after a reported failure.
 */
export async function addGroup(button: Element): Promise<ShopifyCart | null> {
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

/** Another tab changed the cart (it is loaded again here) or the visitor's market (this tab follows it). */
export function onStorage(event: StorageEvent): void {
  if (event.key === cfg.storageKey || event.key === `${cfg.storageKey}:seen`) {
    Cart.init().catch((error: unknown) => {
      reportError(error, 'cart from another tab');
    });
    return;
  }
  if (event.key !== marketStorageKey() || !event.newValue) return;
  // A value that isn't a market was written under the key by something else.
  const market = parseSavedMarket(event.newValue);
  if (!market) return;
  // The other tab saved the language it uses, so none saved means none.
  const options = { language: market.language ?? null, locale: market.locale, remember: false };
  setCountry(market.country, options).catch((error: unknown) => {
    reportError(error, 'market from another tab');
  });
}

/** Scope root → its last variant and plan, so the first render doesn't write. */
const urlKeys = new WeakMap<Element, string>();

const numericId = (gid: string) => gid.split('/').pop() ?? gid;

/**
 * Safari throws a SecurityError past 100 history changes in 10 seconds; the address then keeps the previous choice
 * until the next one.
 */
function replaceUrlIfAllowed(url: URL) {
  try {
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // Too many changes in a row: see the function's comment.
  }
}

/**
 * `?variant=` (and `selling_plan=`) follow the visitor's choice.
 *
 * @param root The product scope's root.
 */
export function writeVariantUrl(
  root: Element,
  { variant, sellingPlanId }: { variant: { id: string }; sellingPlanId: string | null | undefined },
): void {
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
