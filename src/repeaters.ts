/**
 * Lists rendered from a template: a repeater's first child in the designer is the template, and every item gets a
 * copy of it. The other children are placeholder content and are removed.
 */
import { cfg, reportError, warn } from './config.ts';

/** Each repeater's template, captured on first render. */
const templates = new WeakMap<Element, HTMLElement | null>();

/** @returns True once the repeater's template has been captured (it may be empty after that). */
export const hasTemplate = (container: Element): boolean => Boolean(templates.get(container));

/**
 * A deep copy of a template. `cloneNode` is typed as returning a `Node`; a copy of an element is an element of the
 * same kind.
 */
const copyOf = (template: HTMLElement) => template.cloneNode(true) as HTMLElement;

function templateOf(container: Element): HTMLElement | null {
  const known = templates.get(container);
  if (known !== undefined) return known;
  const first = container.firstElementChild;
  // Repeaters are HTML lists in the designer; their first child is an HTML element.
  const template = first ? copyOf(first as HTMLElement) : null;
  templates.set(container, template);
  container.replaceChildren();
  return template;
}

/** Rebuilds the list on every render. Fine for images, tags, options. */
export function repeat<Item>(
  container: Element,
  items: readonly Item[],
  render: (node: HTMLElement, item: Item, index: number) => void,
): void {
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

interface KeyedHooks {
  /** Runs on a node inserted for a new item. */
  onEnter?: ((node: HTMLElement) => void) | null;
  /** Runs on a node whose item is gone; `done()` removes it. */
  onLeave?: ((node: HTMLElement, done: () => void) => void) | null;
}

function leave(node: HTMLElement, onLeave: KeyedHooks['onLeave']): void {
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
 * @param wanted Every item's node, in order.
 * @param fresh The nodes not yet in the container.
 */
function insertFresh(
  container: Element,
  wanted: HTMLElement[],
  fresh: Set<HTMLElement>,
  onEnter: KeyedHooks['onEnter'],
): void {
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
 */
export function repeatKeyed<Item>(
  container: Element,
  items: readonly Item[],
  keyOf: (item: Item, index: number) => string | number,
  render: (node: HTMLElement, item: Item, index: number, isNew: boolean) => void,
  { onEnter, onLeave }: KeyedHooks = {},
): void {
  const template = templateOf(container);
  if (!template) {
    warn('repeater without a template child', container);
    return;
  }

  const keyAttribute = `data-${cfg.prefix}-key`;
  const leavingAttribute = `data-${cfg.prefix}-leaving`;
  // The list's children are copies of its template, HTML elements like it.
  const live = () =>
    [...(container.children as HTMLCollectionOf<HTMLElement>)].filter(
      (node) => node.hasAttribute(keyAttribute) && !node.hasAttribute(leavingAttribute),
    );

  const existing = new Map(live().map((node) => [node.getAttribute(keyAttribute), node]));
  const wanted: HTMLElement[] = [];
  const fresh = new Set<HTMLElement>();

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
