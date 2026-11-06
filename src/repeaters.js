/**
 * Lists rendered from a template: a repeater's first child in the designer is the template, and every item gets a
 * copy of it. The other children are placeholder content and are removed.
 */
import { cfg, reportError, warn } from './config.js';

/** @type {WeakMap<Element, HTMLElement | null>} Each repeater's template, captured on first render. */
const templates = new WeakMap();

/**
 * @param {Element} container
 * @returns {boolean} True once the repeater's template has been captured (it may be empty after that).
 */
export const hasTemplate = (container) => Boolean(templates.get(container));

/**
 * A deep copy of a template. `cloneNode` is typed as returning a `Node`; a copy of an element is an element of the
 * same kind.
 *
 * @param {HTMLElement} template
 */
const copyOf = (template) => /** @type {HTMLElement} */ (template.cloneNode(true));

/** @param {Element} container */
function templateOf(container) {
  const known = templates.get(container);
  if (known !== undefined) return known;
  const first = container.firstElementChild;
  // Repeaters are HTML lists in the designer; their first child is an HTML element.
  const template = first ? copyOf(/** @type {HTMLElement} */ (first)) : null;
  templates.set(container, template);
  container.replaceChildren();
  return template;
}

/**
 * Rebuilds the list on every render. Fine for images, tags, options.
 *
 * @template Item
 * @param {Element} container
 * @param {readonly Item[]} items
 * @param {(node: HTMLElement, item: Item, index: number) => void} render
 */
export function repeat(container, items, render) {
  const template = templateOf(container);
  if (!template) {
    if (items.length) warn('repeater without a template child', container);
    return;
  }
  container.replaceChildren();
  items.forEach((item, index) => {
    const node = copyOf(template);
    render(node, item, index);
    container.appendChild(node);
  });
}

/**
 * @typedef {object} KeyedHooks
 * @property {((node: HTMLElement) => void) | null} [onEnter] Runs on a node inserted for a new item.
 * @property {((node: HTMLElement, done: () => void) => void) | null} [onLeave] Runs on a node whose item is gone;
 *   `done()` removes it.
 */

/**
 * @param {HTMLElement} node
 * @param {KeyedHooks['onLeave']} onLeave
 */
function leave(node, onLeave) {
  const done = () => {
    node.remove();
  };
  if (!onLeave) {
    done();
    return;
  }
  try {
    onLeave(node, done);
  } catch (error) {
    reportError(error, 'repeater onLeave');
    done();
  }
}

/**
 * Inserts the nodes of new items next to the item before them, leaving the existing nodes where they are.
 *
 * @param {Element} container
 * @param {HTMLElement[]} wanted Every item's node, in order.
 * @param {Set<HTMLElement>} fresh The nodes not yet in the container.
 * @param {KeyedHooks['onEnter']} onEnter
 */
function insertFresh(container, wanted, fresh, onEnter) {
  wanted.forEach((node, index) => {
    if (!fresh.has(node)) return;
    const previous = wanted[index - 1];
    if (previous?.parentNode === container) previous.after(node);
    else container.prepend(node);
    if (!onEnter) return;
    try {
      onEnter(node);
    } catch (error) {
      reportError(error, 'repeater onEnter');
    }
  });
}

/**
 * Keyed repeater: keeps existing nodes, inserts new ones, removes old ones. Used for cart lines, so values can
 * animate and lines can slide in and out.
 *
 * @template Item
 * @param {Element} container
 * @param {readonly Item[]} items
 * @param {(item: Item, index: number) => string | number} keyOf
 * @param {(node: HTMLElement, item: Item, index: number, isNew: boolean) => void} render
 * @param {KeyedHooks} [hooks]
 */
export function repeatKeyed(container, items, keyOf, render, { onEnter, onLeave } = {}) {
  const template = templateOf(container);
  if (!template) {
    warn('repeater without a template child', container);
    return;
  }

  const keyAttribute = `data-${cfg.prefix}-key`;
  const leavingAttribute = `data-${cfg.prefix}-leaving`;
  const live = () =>
    [.../** @type {HTMLCollectionOf<HTMLElement>} */ (container.children)].filter(
      (node) => node.hasAttribute(keyAttribute) && !node.hasAttribute(leavingAttribute),
    );

  const existing = new Map(live().map((node) => [node.getAttribute(keyAttribute), node]));
  /** @type {HTMLElement[]} */
  const wanted = [];
  /** @type {Set<HTMLElement>} */
  const fresh = new Set();

  items.forEach((item, index) => {
    const key = String(keyOf(item, index));
    let node = existing.get(key);
    if (node) existing.delete(key);
    else {
      node = copyOf(template);
      node.setAttribute(keyAttribute, key);
      fresh.add(node);
    }
    render(node, item, index, fresh.has(node));
    wanted.push(node);
  });

  const staying = wanted.filter((node) => !fresh.has(node));
  const current = live().filter((node) => staying.includes(node));
  const inOrder = current.length === staying.length && current.every((node, index) => node === staying[index]);

  if (!inOrder) {
    existing.forEach((node) => {
      node.remove();
    });
    wanted.forEach((node) => container.appendChild(node));
    return;
  }

  insertFresh(container, wanted, fresh, onEnter);

  existing.forEach((node) => {
    node.setAttribute(leavingAttribute, '');
    node.removeAttribute(keyAttribute);
    node.style.pointerEvents = 'none';
    node.inert = true;
    leave(node, onLeave);
  });
}
