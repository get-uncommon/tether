/**
 * How Tether finds its markup: attribute names carry the configured prefix (`tether-product`, or `wfs-product` with
 * `prefix: 'wfs'`), and so do the selectors and the DOM events built from them.
 */
import { cfg } from './config.js';

/**
 * @param {string} name
 * @returns {string} The prefixed attribute name: `product` → `tether-product`.
 */
export const attr = (name) => `${cfg.prefix}-${name}`;

/**
 * @param {string} name
 * @param {string} [value]
 * @returns {string} A selector for the attribute, with that exact value when given.
 */
export const sel = (name, value) => (value === undefined ? `[${attr(name)}]` : `[${attr(name)}="${value}"]`);

/**
 * @param {Element} el
 * @param {string} name
 */
export const get = (el, name) => el.getAttribute(attr(name));

/**
 * @param {Element} el
 * @param {string} name
 */
export const has = (el, name) => el.hasAttribute(attr(name));

/**
 * Tether's attributes go on HTML elements, so matches are typed as such. An SVG element that carries one still has
 * the `style`, `dataset` and attribute methods Tether uses.
 *
 * @param {ParentNode | null | undefined} root
 * @param {string} selector
 * @returns {HTMLElement[]} The matches in `root`, none without a root.
 */
export function qsa(root, selector) {
  if (!root) return [];
  return [.../** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll(selector))];
}

/**
 * @param {Element | null | undefined} root
 * @param {string} selector
 * @param {string} scopeSelector
 * @returns {HTMLElement[]} Matches in `root` whose nearest `scopeSelector` ancestor is `root` itself, not a nested
 *   scope.
 */
export const scoped = (root, selector, scopeSelector) =>
  qsa(root, selector).filter((el) => el.closest(scopeSelector) === root);

/**
 * Dispatches the bubbling event `<prefix>:<name>`.
 *
 * @param {string} name
 * @param {unknown} [detail]
 * @param {EventTarget} [target]
 */
export function emit(name, detail, target = document) {
  target.dispatchEvent(new CustomEvent(`${cfg.prefix}:${name}`, { detail, bubbles: true }));
}
