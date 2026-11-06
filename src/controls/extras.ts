/**
 * The document-wide listeners whose work is in the optional extras part, loaded when one of them first has work:
 * group add buttons, the cart or market changing in another tab, and shareable variant links. A part that can't load
 * (a self-hosted site without `tether.extras.min.js`) is reported, so the missing file shows.
 */
import { cfg, reportError } from '../config.ts';
import { attr, sel, busy, isOwnEvent } from '../dom.ts';
import { loadPart } from '../lazy.ts';
import type { ShopifyCart } from '../cart/store.ts';

/** `[tether-group]` with `[tether-group-add]`: adds every product scope inside the group in one request. */
export const addGroup = (button: Element): Promise<ShopifyCart | null> =>
  loadPart('extras').then((part) => part.addGroup(button));

const reportExtrasError = (error: unknown) => {
  reportError(error, 'extras');
};

function onClick(event: MouseEvent): void {
  const { target } = event;
  const button = target instanceof window.Element ? target.closest(sel('group-add')) : null;
  if (!button) return;
  event.preventDefault();
  busy(button, () => addGroup(button)).catch(reportExtrasError);
}

function onStorage(event: StorageEvent): void {
  if (!cfg.domain || !event.key?.startsWith(`${cfg.prefix}:`)) return;
  loadPart('extras')
    .then((part) => {
      part.onStorage(event);
    })
    .catch(reportExtrasError);
}

/** @param event `tether:variant-changed`, which a product scope emits; one another script dispatches is ignored. */
function onVariantChanged(event: Event): void {
  if (!isOwnEvent(event, 'variant-changed')) return;
  const { target } = event;
  if (!(target instanceof window.Element)) return;
  if (!cfg.variantUrl && !target.hasAttribute(attr('variant-url'))) return;
  loadPart('extras')
    .then((part) => {
      part.writeVariantUrl(target, event.detail);
    })
    .catch(reportExtrasError);
}

/** Binds the document-wide listeners, once per page load of the script. */
export function bindExtrasControls(): void {
  document.addEventListener('click', onClick);
  window.addEventListener('storage', onStorage);
  document.addEventListener(`${cfg.prefix}:variant-changed`, onVariantChanged);
}
