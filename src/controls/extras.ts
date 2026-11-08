/**
 * The document-wide listeners whose work is in the optional extras part, loaded when one of them first has work:
 * group add buttons, the cart or market changing in another tab, and shareable variant links. A part that can't load
 * (a self-hosted site without `tether.extras.min.js`) is reported, so the missing file shows.
 */
import { cfg, reportFailure } from '../config.ts';
import { attr, sel, busy, isElement, isOwnEvent } from '../dom.ts';
import { loadPart } from '../lazy.ts';
import { withPart } from '../part-use.ts';
import { storageKey as marketStorageKey } from '../markets.ts';
import { seenKey } from '../cart/store.ts';
import type { ShopifyCart } from '../cart/store.ts';

/** `[tether-group]` with `[tether-group-add]`: adds every product scope inside the group in one request. */
export const addGroup = (button: Element): Promise<ShopifyCart | null> =>
  loadPart('extras').then((part) => part.addGroup(button));

function onClick(event: MouseEvent): void {
  const { target } = event;
  const button = isElement(target) ? target.closest(sel('group-add')) : null;
  if (!button) return;
  event.preventDefault();
  reportFailure(
    busy(button, () => addGroup(button)),
    'extras',
  );
}

/**
 * Loads the part only for the keys it follows (the cart's id and saved count, and the market) and for `null`, which
 * `localStorage.clear()` sends: the page's other scripts may write their own keys often.
 */
function onStorage(event: StorageEvent): void {
  const followed = [null, cfg.storageKey, seenKey(), marketStorageKey()];
  if (!cfg.domain || !followed.includes(event.key)) return;
  withPart('extras', (part) => {
    part.onStorage(event);
  });
}

/** @param event `tether:variant-changed`, which a product scope emits; one another script dispatches is ignored. */
function onVariantChanged(event: Event): void {
  if (!isOwnEvent(event, 'variant-changed')) return;
  const { target } = event;
  if (!isElement(target)) return;
  if (!cfg.variantUrl && !target.hasAttribute(attr('variant-url'))) return;
  withPart('extras', (part) => {
    part.writeVariantUrl(target, event.detail);
  });
}

/** Binds the document-wide listeners, once per page load of the script. */
export function bindExtrasControls(): void {
  document.addEventListener('click', onClick);
  window.addEventListener('storage', onStorage);
  document.addEventListener(`${cfg.prefix}:variant-changed`, onVariantChanged);
}
