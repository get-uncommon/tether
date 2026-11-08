import type { Product, ProductVariant } from './fragments.js';
import type { ShopifyCart } from './cart/store.js';
import type { PlanInGroup } from './selling-plans.js';
import type { Purchase, Selection } from './product-state.js';
/** What a scope adds to the cart. */
interface CartLineInput {
    merchandiseId: string;
    quantity: number;
    sellingPlanId?: string;
    attributes?: {
        key: string;
        value: string;
    }[];
}
export declare const scopes: WeakMap<Element, ProductScope>;
export declare function rememberOptionNames(products: readonly Pick<Product, 'handle' | 'options'>[]): void;
export declare class ProductScope {
    readonly root: HTMLElement;
    product: Product;
    plans: PlanInGroup[];
    selected: Selection;
    /** How the visitor buys; `setPurchase` and `selectPlan` change it. */
    purchase: Purchase;
    variant: ProductVariant | null;
    quantity: number;
    constructor(root: HTMLElement, product: Product);
    /** New data for the same product (a country switch). Keeps the visitor's choice. */
    update(product: Product): void;
    /** @returns Matches in this scope, including the root itself (a card link with tether-bind="link"). */
    $(selector: string): HTMLElement[];
    /**
     * @param authored An option name in the markup.
     * @returns The product's option of that name, or at that position in the build's language.
     */
    optName(authored: string | null): string;
    get plan(): PlanInGroup | null;
    /** True when the current variant can be bought on a plan. */
    get subscriptionAvailable(): boolean;
    /** True when the line is bought on a plan: subscribing, and the variant is on the plan. */
    get isSubscription(): boolean;
    /** @returns What would be added to the cart right now. */
    getLine(): CartLineInput | null;
    /** @returns `tether-line-attributes` and the filled `tether-line-attribute` fields. */
    collectAttributes(): {
        key: string;
        value: string;
    }[];
    /**
     * Selects an option value. A combination no variant has moves to the closest variant with the value: the most other
     * choices kept, then one for sale.
     */
    select(name: string, value: string): void;
    /** @param id A variant gid or numeric id. */
    selectVariant(id: string): void;
    setPurchase(kind: Purchase['kind']): void;
    /** @param ref A plan id, numeric id, name or option value. */
    selectPlan(ref: string | null): void;
    setQuantity(quantity: number | string): void;
    /** @returns The cart after adding; `null` when the variant can't be added. */
    addToCart(): Promise<ShopifyCart | null>;
    /** Learns the markup's option names when they are the product's, then writes the product. */
    renderProduct(): void;
    /** Derives the view of the current choice, keeps its variant, selection and purchase, and writes it. */
    renderVariant(): void;
}
/**
 * A product scope as a site sees it (`Tether.getScope()`, the `product-ready` and `product-updated` events): its fields
 * change only through its methods, which keep the page in step with them.
 */
export type ReadonlyProductScope = Readonly<ProductScope>;
export {};
