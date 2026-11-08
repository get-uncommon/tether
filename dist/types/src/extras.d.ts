import type { ShopifyCart } from './cart/store.js';
/**
 * `[tether-group]` with `[tether-group-add]`: adds every product scope inside the group in one request, for bundles,
 * build-a-box and "complete the set". The lines get the attribute `_group` and the group's `tether-line-attributes`.
 *
 * @returns The cart, `null` with nothing to add or after a reported failure.
 */
export declare function addGroup(button: Element): Promise<ShopifyCart | null>;
/** Applies the code a `tether-discount-form` submitted; one Shopify refuses marks the form `is-invalid`. */
export declare function applyDiscountCode(form: Element, input: HTMLInputElement | null, code: string): Promise<void>;
/**
 * Another tab changed the cart (it is loaded again here) or the visitor's market (this tab follows it), or cleared the
 * storage (`key` is `null`), which the cart is loaded again for.
 */
export declare function onStorage(event: StorageEvent): void;
/**
 * `?variant=` (and `selling_plan=`) follow the visitor's choice.
 *
 * @param root The product scope's root.
 */
export declare function writeVariantUrl(root: Element, { variant, sellingPlanId }: {
    variant: {
        id: string;
    };
    sellingPlanId: string | null | undefined;
}): void;
