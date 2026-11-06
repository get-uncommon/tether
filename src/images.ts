/**
 * Shopify images on the page: sized through the CDN's URL parameters, written to an `<img>` or as a CSS background,
 * and never downloaded twice when the server already rendered the same image.
 */
import { attr } from './markup.ts';

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
export function imageUrl<Url extends string | null | undefined>(
  url: Url,
  { width, height, crop }: ImageSize = {},
): Url {
  if (!url) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    // A relative or malformed URL has no CDN parameters to set: it is used as written.
    if (error instanceof TypeError) return url;
    throw error;
  }
  if (width) parsed.searchParams.set('width', String(width));
  if (height) parsed.searchParams.set('height', String(height));
  if (crop) parsed.searchParams.set('crop', crop);
  // `url` is a non-empty string here, so `Url` is a string type.
  return parsed.toString() as Url;
}

/** @returns `name` as Webflow's custom attribute, or in valid HTML as `<prefix>-name` / `data-name`. */
function sizeAttribute(el: Element, name: string): string | null {
  return el.getAttribute(name) ?? el.getAttribute(attr(name)) ?? el.getAttribute(`data-${name}`);
}

/** @param el The element whose max-width / max-height / crop attributes size the image. */
export function cdnUrl<Url extends string | null | undefined>(url: Url, el: Element | null | undefined): Url {
  if (!url || !el) return url;
  const width = sizeAttribute(el, 'max-width');
  const height = sizeAttribute(el, 'max-height');
  return imageUrl(url, { width, height, crop: width || height ? sizeAttribute(el, 'crop') : null });
}

/** @returns The URL without its query (the size parameters). */
const withoutQuery = (url: string) => url.replace(/\?.*$/, '');

/** @returns True for the same image at any size parameters: the server-rendered one is kept. */
export function sameImage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return withoutQuery(a) === withoutQuery(b);
}

/**
 * A CSS `url()` for an image URL from Shopify. Characters that would end the string are escaped, so the URL can't
 * add declarations; only http(s), relative and data:image URLs are used.
 */
function cssUrl(url: string): string {
  const hasScheme = /^\s*[a-z][a-z0-9+.-]*:/i.test(url);
  if (hasScheme && !/^\s*(https?:|data:image\/)/i.test(url)) return 'none';
  const escaped = url.replace(/["\\\n\r\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
  return `url("${escaped}")`;
}

/** Shows `url` in `el`: as the `src` of an `<img>` (lazy unless it says otherwise), else as its background image. */
export function setImage(el: HTMLElement, url: string | null | undefined, alt?: string | null): void {
  if (!url) return;
  const src = cdnUrl(url, el);
  if (el.tagName !== 'IMG') {
    el.style.backgroundImage = cssUrl(src);
    return;
  }
  if (sameImage(el.getAttribute('src'), src)) {
    if (alt != null && !el.getAttribute('alt')) el.setAttribute('alt', alt);
    return;
  }
  el.removeAttribute('srcset');
  el.removeAttribute('sizes');
  el.setAttribute('src', src);
  if (alt != null) el.setAttribute('alt', alt);
  if (!el.getAttribute('loading')) el.setAttribute('loading', 'lazy');
}
