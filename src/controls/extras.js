/**
 * The document-wide listeners whose work is in the optional extras part, loaded when one of them first has work:
 * group add buttons, the cart or market changing in another tab, and shareable variant links. A part that can't load
 * (a self-hosted site without `tether.extras.min.js`) is reported, so the missing file shows.
 */
import { cfg, reportError } from '../config.js';
import { attr, sel, busy } from '../dom.js';
import { loadPart } from '../lazy.js';
/** @import { ShopifyCart } from '../cart/store.js' */

/** @typedef {Parameters<typeof import('../extras.js').writeVariantUrl>[1]} VariantChoice */

/**
 * `[tether-group]` with `[tether-group-add]`: adds every product scope inside the group in one request.
 *
 * @param {Element} button
 * @returns {Promise<ShopifyCart | null>}
 */
export const addGroup = (button) => loadPart('extras').then((part) => part.addGroup(button));

/** @param {unknown} error */
const reportExtrasError = (error) => {
  reportError(error, 'extras');
};

/** @param {MouseEvent} event */
function onClick(event) {
  const { target } = event;
  const button = target instanceof window.Element ? target.closest(sel('group-add')) : null;
  if (!button) return;
  event.preventDefault();
  busy(button, () => addGroup(button)).catch(reportExtrasError);
}

/** @param {StorageEvent} event */
function onStorage(event) {
  if (!cfg.domain || !event.key?.startsWith(`${cfg.prefix}:`)) return;
  loadPart('extras')
    .then((part) => {
      part.onStorage(event);
    })
    .catch(reportExtrasError);
}

/** @param {CustomEvent<VariantChoice>} event `tether:variant-changed`, which a product scope emits. */
function onVariantChanged(event) {
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
export function bindExtrasControls() {
  document.addEventListener('click', onClick);
  window.addEventListener('storage', onStorage);
  // Only product scopes emit this event, always with a CustomEvent.
  document.addEventListener(`${cfg.prefix}:variant-changed`, /** @type {EventListener} */ (onVariantChanged));
}
