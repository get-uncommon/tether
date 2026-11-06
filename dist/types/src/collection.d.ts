import type { Product } from './fragments.js';
import type { Collection, PageInfo, ProductQuery } from './loader.js';
export declare const listSelector: () => string;
export declare class ListScope {
    readonly root: HTMLElement;
    products: Product[];
    pageInfo: PageInfo | null;
    collection: Collection | null;
    /** Counts loads, so only the latest one renders. */
    loadToken: number;
    constructor(root: HTMLElement);
    $(selector: string): HTMLElement[];
    /** The collection or search query of the list's attributes. */
    options(): ProductQuery;
    /**
     * The product of a recommendations list: a handle, `url:…` (one dynamic product page), or empty inside a product
     * scope for that product.
     *
     * @throws {TetherError} `NOT_FOUND` when there is no product to recommend for.
     */
    loadRecommendations(): Promise<Product[]>;
    /** @param more Appends the next page instead of replacing the products. */
    load(more?: boolean): Promise<void>;
    render(): void;
}
