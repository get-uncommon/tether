/** @returns True once the repeater's template has been captured (it may be empty after that). */
export declare const hasTemplate: (container: Element) => boolean;
/** Rebuilds the list on every render. Fine for images, tags, options. */
export declare function repeat<Item>(container: Element, items: readonly Item[], render: (node: HTMLElement, item: Item, index: number) => void): void;
interface KeyedHooks {
    /** Runs on a node inserted for a new item. */
    onEnter?: ((node: HTMLElement) => void) | null;
    /** Runs on a node whose item is gone; `done()` removes it. */
    onLeave?: ((node: HTMLElement, done: () => void) => void) | null;
}
/**
 * Keyed repeater: keeps existing nodes, inserts new ones, removes old ones. Used for cart lines, so values can
 * animate and lines can slide in and out.
 */
export declare function repeatKeyed<Item>(container: Element, items: readonly Item[], keyOf: (item: Item, index: number) => string | number, render: (node: HTMLElement, item: Item, index: number, isNew: boolean) => void, { onEnter, onLeave }?: KeyedHooks): void;
export {};
