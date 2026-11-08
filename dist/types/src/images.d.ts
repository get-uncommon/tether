/** Shopify CDN parameters. */
export interface ImageSize {
    width?: string | number | null;
    height?: string | number | null;
    /** `center`, `top`, `bottom`, `left` or `right`; only applies with a width or height. */
    crop?: string | null;
}
/**
 * Shopify CDN image at a size: `imageUrl(url, { width: 800 })`. Use the same width as the element's max-width
 * attribute, so the browser script keeps the image instead of loading it again.
 *
 * @returns The sized URL; `url` itself when it is empty or not absolute.
 */
export declare function imageUrl<Url extends string | null | undefined>(url: Url, { width, height, crop }?: ImageSize): Url;
/** @param el The element whose max-width / max-height / crop attributes size the image. */
export declare function cdnUrl<Url extends string | null | undefined>(url: Url, el: Element | null | undefined): Url;
/** @returns True for the same image at any size parameters: the server-rendered one is kept. */
export declare function sameImage(a: string | null | undefined, b: string | null | undefined): boolean;
/** Shows `url` in `el`: as the `src` of an `<img>` (lazy unless it says otherwise), else as its background image. */
export declare function setImage(el: HTMLElement, url: string | null | undefined, alt?: string | null): void;
