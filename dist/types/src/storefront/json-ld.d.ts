import type { Product } from '../fragments.js';
export interface JsonLdOptions {
    /** The product page's absolute URL; default from the storefront's `siteUrl`. */
    url?: string;
    /** Default the product's vendor. */
    brand?: string;
}
/** Where the product pages are. */
interface JsonLdSite {
    productPath: string;
    siteUrl: string | undefined;
}
/**
 * Text for a `<script>` tag: `<` is escaped so product text can never close the tag, and U+2028 / U+2029 so older
 * JavaScript parsers read it.
 */
export declare const scriptJson: (value: unknown) => string;
/** @returns The schema.org object, `null` without a product. */
export declare function jsonLdData(product: Product | null | undefined, options: JsonLdOptions, site: JsonLdSite): Record<string, unknown> | null;
export {};
