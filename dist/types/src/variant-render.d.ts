import type { ProductView } from './product-state.js';
import type { RenderScope } from './product-render.js';
/**
 * The element of an add-to-cart button that holds its label, with the label as written kept in
 * `data-tether-label`, so mode-dependent texts (`tether-subscribe-text`, `tether-soldout-text`) can be undone.
 */
export declare function addButtonLabel(button: HTMLElement): {
    label: HTMLElement;
    original: string;
};
/**
 * Writes what follows the variant and purchase.
 */
export declare function writeVariant(scope: RenderScope, view: ProductView): void;
