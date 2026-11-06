import type { Product } from './fragments.js';
import type { PlanInGroup } from './selling-plans.js';
/** The product scope as its renders see it. */
export interface RenderScope {
    readonly root: HTMLElement;
    readonly product: Product;
    readonly plans: PlanInGroup[];
    /** Matches in this scope, the root included. */
    $: (selector: string) => HTMLElement[];
    /** The product's option name for one written in the markup. */
    optName: (authored: string | null) => string;
}
export declare const isSelect: (el: Element) => el is HTMLSelectElement;
/** @returns The `<select>` elements in the scope that match `selector`. */
export declare const selectsIn: (scope: RenderScope, selector: string) => HTMLSelectElement[];
/** Writes what depends on the product alone: its binds, option and plan lists and the selects' options. */
export declare function writeProduct(scope: RenderScope): void;
