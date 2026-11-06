/**
 * HTML written in the Shopify admin (product and collection descriptions), made safe to insert into the site. Store
 * staff and apps that can edit products are not trusted to act on the storefront, where customer sessions live. Only
 * elements and attributes that show content are kept (an allow-list, so markup nobody reviewed is never let in):
 * text formatting, lists, tables, images, links and video embeds look as written, inline `style` included, because
 * the Shopify editor writes its formatting there. Script, page-wide `<style>` and forms (which could post the
 * visitor's input anywhere) are removed, and embeds run sandboxed. What stays can't reach outside the description's
 * box: no `id` (it would clobber `window.<id>` and the site's own ids), no style that positions content over the page
 * or fetches anything, and no embed from the site's own origin, where a sandbox can be lifted from inside.
 */

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** The elements kept, by local name. Any other element is replaced by its content, which is cleaned the same way. */
const ALLOWED_ELEMENTS = new Set([
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'br', 'hr', 'blockquote', 'code', 'pre'],
  ...['strong', 'em', 'b', 'i', 'u', 's', 'small', 'sub', 'sup'],
  ...['ul', 'ol', 'li', 'dl', 'dt', 'dd'],
  ...['table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'],
  ...['a', 'img', 'picture', 'source', 'video', 'figure', 'figcaption', 'iframe'],
]);
/** Elements whose content is code, styles or form state rather than text to show: removed with their content. */
const REMOVED_WITH_CONTENT = new Set(['script', 'style', 'template', 'noscript', 'textarea', 'select', 'title']);

/** Attributes any kept element may have, and every `aria-*` one (`isAllowedAttribute`). */
const GLOBAL_ATTRIBUTES = new Set(['class', 'style', 'title', 'lang', 'dir', 'role', 'align', 'width', 'height']);
/** Further attributes per element. */
const ELEMENT_ATTRIBUTES = new Map([
  ['a', new Set(['href', 'target', 'rel', 'hreflang'])],
  ['img', new Set(['src', 'srcset', 'sizes', 'alt', 'loading', 'decoding'])],
  ['source', new Set(['src', 'srcset', 'sizes', 'type', 'media'])],
  ['video', new Set(['src', 'poster', 'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'preload'])],
  ['iframe', new Set(['src', 'allow', 'allowfullscreen', 'frameborder', 'loading'])],
  ['blockquote', new Set(['cite'])],
  ['ol', new Set(['start', 'type', 'reversed'])],
  ['li', new Set(['value'])],
  ['table', new Set(['border', 'cellpadding', 'cellspacing', 'summary'])],
  ['col', new Set(['span'])],
  ['colgroup', new Set(['span'])],
  ['th', new Set(['colspan', 'rowspan', 'headers', 'scope', 'valign'])],
  ['td', new Set(['colspan', 'rowspan', 'headers', 'valign'])],
]);
/** Attributes whose value is fetched or navigated to. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'poster', 'cite']);
/** Schemes that run code when navigated to. */
const SCRIPT_URL = /^(javascript|vbscript|data):/i;
/** `data:` stays allowed for images, which only decode pixels. */
const DATA_IMAGE = /^data:image\/(png|gif|jpeg|webp|avif);/i;

/**
 * Style properties that take content out of the flow and place it over the rest of the page (a full-page overlay is
 * a phishing form on the shop's own origin). `inset` and its logical forms are matched by prefix.
 */
const POSITIONING_PROPERTIES = new Set(['position', 'top', 'right', 'bottom', 'left', 'z-index']);
/** Style values that fetch a resource or run code (`expression()` in old Internet Explorer). */
const FETCHING_VALUE = /url\(|expression\(|@import/i;

/** Browsers ignore control characters and spaces in a URL's scheme (`java^Iscript:`), so the check does too. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what browsers skip in a scheme
const IGNORED_IN_SCHEME = /[\u0000- ]/g;

/**
 * An embed runs its own player script on its own origin, but can't navigate this page, open dialogs over it or submit
 * forms. `allow-same-origin` keeps the player's own storage and cookies, which YouTube and Vimeo need.
 */
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation';
/**
 * The permissions an embed may ask the page to delegate: the ones video players and social embeds use. Camera,
 * microphone, location, payment and the rest are never delegated to store content.
 */
const IFRAME_FEATURES = new Set([
  ...['autoplay', 'encrypted-media', 'picture-in-picture', 'fullscreen', 'clipboard-write'],
  ...['accelerometer', 'gyroscope', 'web-share'],
]);
/** Players check which site embeds them (YouTube refuses to play without it): the origin is sent, never the path. */
const IFRAME_REFERRER_POLICY = 'strict-origin-when-cross-origin';

/**
 * @param {string} tag
 * @param {string} name An attribute name, lower case.
 */
function isAllowedAttribute(tag, name) {
  return GLOBAL_ATTRIBUTES.has(name) || name.startsWith('aria-') || (ELEMENT_ATTRIBUTES.get(tag)?.has(name) ?? false);
}

/**
 * @param {string} tag
 * @param {string} name
 * @param {string} value
 * @returns {boolean} False for a URL that would run script.
 */
function isSafeUrl(tag, name, value) {
  const url = value.replace(IGNORED_IN_SCHEME, '');
  if (!SCRIPT_URL.test(url)) return true;
  return tag === 'img' && name === 'src' && DATA_IMAGE.test(url);
}

/**
 * @param {string} value
 * @param {string} [base]
 * @returns {URL | null} Null for text that is not a URL, which no check below lets through.
 */
function urlOrNull(value, base) {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/**
 * What cleaning needs to know about the page the fragment is for.
 *
 * @typedef {object} Page
 * @property {string | null} origin The page's origin, `null` when it has none (`about:blank`).
 * @property {string} baseUrl Relative URLs resolve against it, as they will once the fragment is inserted.
 * @property {HTMLElement} styleParser An element whose `style` parses declarations the way the browser applies them.
 */

/**
 * @param {Document} document
 * @param {HTMLElement} styleParser
 * @returns {Page}
 */
function pageOf(document, styleParser) {
  const baseUrl = document.baseURI;
  const origin = urlOrNull(baseUrl)?.origin ?? 'null';
  return { origin: origin === 'null' ? null : origin, baseUrl, styleParser };
}

/**
 * @param {string} value An iframe's `src`.
 * @param {Page} page
 * @returns {boolean} True for an https URL on another origin than the page's: any other embed is removed.
 */
function isForeignHttpsEmbed(value, page) {
  const url = urlOrNull(value.trim(), page.baseUrl);
  return url?.protocol === 'https:' && url.origin !== page.origin;
}

/**
 * @param {string} value An iframe's `allow` attribute: features separated by `;`, each with an optional allowlist.
 * @returns {string} The features from `IFRAME_FEATURES` alone, each for the embed's own origin.
 */
function allowedFeatures(value) {
  const features = value.split(';').map((directive) => directive.trim().split(/\s+/)[0]?.toLowerCase() ?? '');
  return [...new Set(features.filter((feature) => IFRAME_FEATURES.has(feature)))].join('; ');
}

/** @param {string} property A style property name, lower case. */
function isPositioning(property) {
  return POSITIONING_PROPERTIES.has(property) || property.startsWith('inset');
}

/**
 * An inline style as the browser's own parser reads it, without positioning or fetching declarations. The parsed
 * form is written back, so text the parser skipped (an unknown or malformed declaration) is gone too.
 *
 * @param {string} value
 * @param {HTMLElement} styleParser
 * @returns {string}
 */
function cleanStyle(value, styleParser) {
  const style = styleParser.style;
  style.cssText = value;
  const properties = Array.from({ length: style.length }, (_, index) => style.item(index));
  for (const property of properties) {
    if (isPositioning(property) || FETCHING_VALUE.test(style.getPropertyValue(property))) {
      style.removeProperty(property);
    }
  }
  const cleaned = style.cssText;
  styleParser.removeAttribute('style');
  return cleaned;
}

/**
 * @param {Element} element An allowed element: its other attributes are removed.
 * @param {Page} page
 */
function cleanAttributes(element, page) {
  const tag = element.localName;
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    const isUrl = URL_ATTRIBUTES.has(name);
    const keep = isAllowedAttribute(tag, name) && (!isUrl || isSafeUrl(tag, name, attribute.value));
    if (!keep) element.removeAttribute(attribute.name);
  }
  const style = element.getAttribute('style');
  if (style === null) return;
  const cleaned = cleanStyle(style, page.styleParser);
  if (cleaned === '') element.removeAttribute('style');
  else element.setAttribute('style', cleaned);
}

/** @param {Element} element A kept element, its attributes cleaned. */
function hardenEmbedsAndLinks(element) {
  if (element.localName === 'iframe') {
    const allow = allowedFeatures(element.getAttribute('allow') ?? '');
    if (allow === '') element.removeAttribute('allow');
    else element.setAttribute('allow', allow);
    element.setAttribute('sandbox', IFRAME_SANDBOX);
    element.setAttribute('referrerpolicy', IFRAME_REFERRER_POLICY);
    return;
  }
  if (element.localName !== 'a' || element.getAttribute('target')?.toLowerCase() !== '_blank') return;
  // The opened page gets no handle on this one (`window.opener`) and isn't told which page linked to it.
  const rel = new Set((element.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean));
  rel.add('noopener');
  rel.add('noreferrer');
  element.setAttribute('rel', [...rel].join(' '));
}

/**
 * @param {Element} element
 * @param {Page} page
 */
function cleanElement(element, page) {
  const tag = element.localName;
  const isHtml = element.namespaceURI === HTML_NAMESPACE;
  if (isHtml && REMOVED_WITH_CONTENT.has(tag)) {
    element.remove();
    return;
  }
  if (!isHtml || !ALLOWED_ELEMENTS.has(tag)) {
    element.replaceWith(...element.childNodes);
    return;
  }
  if (tag === 'iframe' && !isForeignHttpsEmbed(element.getAttribute('src') ?? '', page)) {
    element.remove();
    return;
  }
  cleanAttributes(element, page);
  hardenEmbedsAndLinks(element);
}

/**
 * Store HTML as a fragment of content elements only.
 *
 * @param {string | null | undefined} html
 * @param {Document} [document] The document the fragment is for.
 * @returns {DocumentFragment}
 */
export function storeHtmlFragment(html, document = globalThis.document) {
  const template = document.createElement('template');
  // A <template>'s content is parsed inert: nothing in it loads or runs before it is cleaned.
  // eslint-disable-next-line no-restricted-syntax -- parsing into an inert template is the sanctioned way in
  template.innerHTML = html ?? '';
  // The template itself is never inserted, so its own `style` is a free parser for the content's declarations.
  const page = pageOf(document, template);
  // Document order: a replaced element's content moves up and is visited after it; what a removed one held leaves
  // the fragment with it.
  for (const element of [...template.content.querySelectorAll('*')]) cleanElement(element, page);
  return template.content;
}
