// @ts-nocheck
/**
 * Optional part with features that load when first needed: bundles (on the first "add set"
 * click), tab sync (on the first change in another tab) and shareable variant links (on the
 * first variant change, with variantUrl or tether-variant-url).
 */
import { cfg, warn, reportError } from './config.js';
import { sel, get, has, qsa, emit, parseJSONAttr, toAttributes } from './dom.js';
import { scopes } from './product.js';
import { Cart } from './cart.js';

/**
 * [tether-group] + [tether-group-add]: adds every product scope inside the group in one request.
 * Bundles, build-a-box, "complete the set". Lines get attribute _group (and tether-line-attributes).
 */
export async function addGroup(btn) {
  const group = btn.closest(sel('group'));
  if (!group) return null;
  const name = get(group, 'group');
  const extra = toAttributes(parseJSONAttr(group, 'line-attributes'));
  const groupAttrs = name ? [{ key: '_group', value: name }, ...extra] : extra;
  const lines = qsa(group, sel('product'))
    .map((el) => scopes.get(el))
    .filter((s) => s && s.variant?.availableForSale && s.quantity > 0)
    .map((s) => {
      const l = s.getLine();
      l.attributes = [...(l.attributes || []), ...groupAttrs];
      return l;
    });
  if (!lines.length) {
    warn('group-add: nothing selected');
    return null;
  }
  try {
    const cart = await Cart.add(lines);
    emit('group-added', { group: name, lines }, group);
    return cart;
  } catch (err) {
    reportError(err, 'group add');
    return null;
  }
}

/** Another tab changed the cart (reload it here) or the visitor's market (follow it). */
export function onStorage(e) {
  if (e.key === cfg.storageKey || e.key === `${cfg.storageKey}:seen`) Cart.init();
  else if (e.key === `${cfg.prefix}:market:${cfg.domain}` && e.newValue) {
    try {
      const m = JSON.parse(e.newValue);
      if (m?.country)
        window.Tether?.setCountry(m.country, { language: m.language ?? null, locale: m.locale, remember: false }).catch(
          () => {},
        );
    } catch {
      /* ignore */
    }
  }
}

const urlKeys = new WeakMap(); // scope root -> last variant|plan, so the first render doesn't write

/** ?variant= (and selling_plan=) follow the visitor's choice. */
export function writeVariantUrl(root, { variant, sellingPlanId }) {
  const key = `${variant.id}|${sellingPlanId || ''}`;
  const before = urlKeys.get(root);
  urlKeys.set(root, key);
  if (!before || before === key) return;
  if (!has(root, 'variant-url') && !(cfg.variantUrl && document.querySelector(sel('product')) === root)) return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('variant', variant.id.split('/').pop());
    if (sellingPlanId) u.searchParams.set('selling_plan', sellingPlanId.split('/').pop());
    else u.searchParams.delete('selling_plan');
    window.history.replaceState(window.history.state, '', u);
  } catch {
    /* ignore */
  }
}
