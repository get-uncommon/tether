/**
 * HTML written in the Shopify admin (product and collection descriptions), made safe to insert into the site. Store
 * staff and apps that can edit products are not trusted to act on the storefront, where customer sessions live. Only
 * elements and attributes that show content are kept (an allow-list, so markup nobody reviewed is never let in):
 * text formatting, lists, tables, images, links and video embeds look as written, inline `style` included, because
 * the Shopify editor writes its formatting there. Script, page-wide `<style>` and forms (which could post the
 * visitor's input anywhere) are removed, and embeds run sandboxed.
 *
 * A description stays where it is written, so it can't be laid over the page as a fake login (a phishing form on the
 * shop's own origin). Removed for that: `id` (it would clobber `window.<id>` and the site's own ids); `class`, which
 * would let a description borrow the site's own overlay or modal classes; and every style that takes content out of
 * the flow (`position`, `inset`, `z-index`), moves it from where the flow put it (transforms, motion paths, negative
 * margins, and negative indents and spacing beyond the small values that tighten text, `NEGATIVE_LIMITS`), copies it
 * elsewhere (reflections) or sizes it to the window (viewport and container-query units).
 * Outlines, shadows, filters, border-image and mask-border outsets, text decoration and text stroke paint beyond their
 * element, so they are kept only while every number they give is a pixel length of a few dozen pixels at most
 * (`MAX_PAINT_PX`): enough to set off an image or a callout, too little to cover the page.
 * Styles that fetch anything go too.
 *
 * A frame shows whatever its origin serves, sized as the description likes, so a frame from a page store staff can
 * write would be that fake login. Frames are kept only from the video players in `EMBED_ORIGINS` and the origins the
 * site adds (`embedOrigins`), never from the site's own origin, where a sandbox can be lifted from inside. What an
 * allowed frame shows is up to its host: the host's player, and whatever that player lets its users add (a call to
 * action, an email gate). An origin a site adds is trusted the same way.
 *
 * Not prevented: content wider than the description (a table or embed on a narrow screen, or a box given a large
 * width in pixels) overflows beside it, as in any HTML, and a capped shadow or outline still paints just past it. Tether
 * doesn't clip the element it fills (`contain: paint`, `overflow`), because that would cut off those wide tables and
 * embeds, stop margins collapsing through it and make it contain floats, changing how ordinary descriptions look. A
 * site that wants the clip sets it on that element in its own CSS.
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
const GLOBAL_ATTRIBUTES = new Set(['style', 'title', 'lang', 'dir', 'role', 'align', 'width', 'height']);
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
 * Style properties that take content out of the flow or move it from where the flow put it. `inset` and its logical
 * forms, the transform properties and the motion path (`offset-*`) are matched by prefix (`isOutOfPlace`). A
 * reflection (`-webkit-box-reflect`) paints a copy of the element beside it, as far away as the element is large.
 */
const OUT_OF_PLACE_PROPERTIES = new Set([
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  '-webkit-box-reflect',
]);
const OUT_OF_PLACE_PREFIXES = ['inset', 'transform', 'translate', 'rotate', 'scale', 'offset'];
/**
 * A length in viewport units (`100vw`, `50dvh`, `10vmax`) or container-query units (`100cqw`), which sizes content to
 * the window, not the description: outside a size container, a container-query unit is a small-viewport unit.
 */
const VIEWPORT_LENGTH = /\d(?:[sld]?v|cq)(?:w|h|i|b|min|max)\b/i;
/**
 * Style properties, without a `-webkit-` prefix, that paint beyond their element's box by as far as their numbers
 * say: outlines and their offset, shadows, `filter` (`drop-shadow()`, `blur()`), text decoration and its offset, text
 * stroke, and the outset of a border image or mask border, which a unitless number multiplies by the border width.
 * Browsers list a shorthand's longhands; the border image and mask border shorthands are checked whole where a
 * parser keeps them.
 */
const PAINTS_BEYOND =
  /^(?:outline|box-shadow|text-shadow|filter|text-decoration|text-underline-offset|text-stroke)|^(?:border-image|mask-border|mask-box-image)(?:-outset)?$/;
/** The longest length, in pixels, those properties may give. */
const MAX_PAINT_PX = 40;
/**
 * Properties on which a small negative value only tightens text, with the most a negative value may be in each unit;
 * one in another unit, or beyond the limit, is removed. Spacing stops at -0.25em (-4px at a 16px font), less than the
 * advance of a letter or a space, so text tightens without running back over what precedes it. An indent stops at
 * `MAX_PAINT_PX`, the reach allowed to anything that paints beyond its element.
 */
const NEGATIVE_LIMITS = new Map<string, Partial<Record<string, number>>>([
  ['letter-spacing', { px: 4, em: 0.25 }],
  ['word-spacing', { px: 4, em: 0.25 }],
  ['text-indent', { px: MAX_PAINT_PX }],
]);
/**
 * A number with its unit, if any, captured (`5000px`, `1.5em`, `5e3px`, `100`, `5000%`). Digits inside a word or a
 * hex colour (`#5000ff`) are not one.
 */
const NUMBER = /(?<![\w#.-])[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(%|[a-z]+)?/gi;
/**
 * A function other than `drop-shadow()` and `blur()`, with no function inside it: colours, a filter's colour and
 * opacity changes and a border image's gradient, whose numbers paint nothing beyond the box. They are left out before
 * the numbers are checked.
 */
const NON_LENGTH_FUNCTION = /(?<![\w-])(?!drop-shadow\(|blur\()[\w-]+\([^()]*\)/g;
/**
 * Values whose lengths depend on more than the declaration (the page's custom properties, arithmetic, the
 * environment), so they can't be checked against `MAX_PAINT_PX`.
 */
const COMPUTED_VALUE = /(?:var|calc|min|max|clamp|env|attr)\(/i;
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
 * The video hosts product descriptions embed, by the origin of their embed code: YouTube (and its cookie-less
 * domain), Vimeo, Loom and Wistia. Store staff choose the video these hosts play, not the page around it.
 */
const EMBED_ORIGINS = [
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://www.loom.com',
  'https://fast.wistia.net',
];

/** @param name An attribute name, lower case. */
function isAllowedAttribute(tag: string, name: string): boolean {
  return GLOBAL_ATTRIBUTES.has(name) || name.startsWith('aria-') || (ELEMENT_ATTRIBUTES.get(tag)?.has(name) ?? false);
}

/** @returns False for a URL that would run script. */
function isSafeUrl(tag: string, name: string, value: string): boolean {
  const url = value.replace(IGNORED_IN_SCHEME, '');
  if (!SCRIPT_URL.test(url)) return true;
  return tag === 'img' && name === 'src' && DATA_IMAGE.test(url);
}

/** @returns Null for text that is not a URL, which no check below lets through. */
function urlOrNull(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/** What cleaning needs to know about the page the fragment is for. */
interface Page {
  /** The page's origin, `null` when it has none (`about:blank`). */
  origin: string | null;
  /** Relative URLs resolve against it, as they will once the fragment is inserted. */
  baseUrl: string;
  /** An element whose `style` parses declarations the way the browser applies them. */
  styleParser: HTMLElement;
  /** The origins an iframe may load from. */
  embedOrigins: ReadonlySet<string>;
}

function pageOf(document: Document, styleParser: HTMLElement, embedOrigins: readonly string[]): Page {
  const baseUrl = document.baseURI;
  const origin = urlOrNull(baseUrl)?.origin ?? 'null';
  return {
    origin: origin === 'null' ? null : origin,
    baseUrl,
    styleParser,
    embedOrigins: new Set([...EMBED_ORIGINS, ...embedOrigins]),
  };
}

/**
 * @param value An iframe's `src`.
 * @returns True for a URL on an allowed embed origin other than the page's: any other embed is removed.
 */
function isAllowedEmbed(value: string, page: Page): boolean {
  const url = urlOrNull(value.trim(), page.baseUrl);
  return url !== null && url.origin !== page.origin && page.embedOrigins.has(url.origin);
}

/**
 * @param value An iframe's `allow` attribute: features separated by `;`, each with an optional allowlist.
 * @returns The features from `IFRAME_FEATURES` alone, each for the embed's own origin.
 */
function allowedFeatures(value: string): string {
  const features = value.split(';').map((directive) => directive.trim().split(/\s+/)[0]?.toLowerCase() ?? '');
  return [...new Set(features.filter((feature) => IFRAME_FEATURES.has(feature)))].join('; ');
}

/**
 * @param property A style property name, lower case.
 * @returns True for a declaration that would put content anywhere but where the description's flow puts it.
 */
function isOutOfPlace(property: string, value: string): boolean {
  if (OUT_OF_PLACE_PROPERTIES.has(property) || OUT_OF_PLACE_PREFIXES.some((prefix) => property.startsWith(prefix))) {
    return true;
  }
  if (VIEWPORT_LENGTH.test(value)) return true;
  const limits = NEGATIVE_LIMITS.get(property);
  if (limits) return COMPUTED_VALUE.test(value) || movesBackTooFar(value, limits);
  // A negative margin moves content back over what comes before. A minus sign is a negative length, or a `calc()`
  // that can be one.
  return property.startsWith('margin') && value.includes('-');
}

/** @param limits The most a negative number may be, by its unit (`NEGATIVE_LIMITS`). */
function movesBackTooFar(value: string, limits: Partial<Record<string, number>>): boolean {
  return [...value.matchAll(NUMBER)].some(([number = '', unit = '']) => {
    const amount = parseFloat(number);
    if (amount >= 0) return false;
    const limit = limits[unit.toLowerCase()];
    return limit === undefined || -amount > limit;
  });
}

/**
 * @param property A style property name, lower case.
 * @returns True for a declaration that would paint farther beyond its element than `MAX_PAINT_PX`. Only pixel
 *   lengths can be checked: any other non-zero number counts as too far, whether it has another unit (`em` grows with
 *   the font size, which a description sets too), a percentage or none (an outset's multiple of the border width).
 */
function paintsTooFar(property: string, value: string): boolean {
  if (!PAINTS_BEYOND.test(property.replace(/^-webkit-/, ''))) return false;
  if (COMPUTED_VALUE.test(value)) return true;
  return [...value.replace(NON_LENGTH_FUNCTION, '').matchAll(NUMBER)].some(([number = '', unit = '']) => {
    const amount = Math.abs(parseFloat(number));
    return amount !== 0 && (unit.toLowerCase() !== 'px' || amount > MAX_PAINT_PX);
  });
}

/**
 * An inline style as the browser's own parser reads it, without out-of-place, far-painting or fetching declarations. The parsed
 * form is written back, so text the parser skipped (an unknown or malformed declaration) is gone too.
 */
function cleanStyle(value: string, styleParser: HTMLElement): string {
  const style = styleParser.style;
  style.cssText = value;
  const properties = Array.from({ length: style.length }, (_, index) => style.item(index));
  for (const property of properties) {
    const value = style.getPropertyValue(property);
    const remove = isOutOfPlace(property, value) || paintsTooFar(property, value) || FETCHING_VALUE.test(value);
    if (remove) style.removeProperty(property);
  }
  const cleaned = style.cssText;
  styleParser.removeAttribute('style');
  return cleaned;
}

/** @param element An allowed element: its other attributes are removed. */
function cleanAttributes(element: Element, page: Page): void {
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

/** @param element A kept element, its attributes cleaned. */
function hardenEmbedsAndLinks(element: Element): void {
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

function cleanElement(element: Element, page: Page): void {
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
  if (tag === 'iframe' && !isAllowedEmbed(element.getAttribute('src') ?? '', page)) {
    element.remove();
    return;
  }
  cleanAttributes(element, page);
  hardenEmbedsAndLinks(element);
}

/**
 * Store HTML as a fragment of content elements only.
 *
 * @param document The document the fragment is for.
 * @param embedOrigins Origins iframes may load from besides the video players in `EMBED_ORIGINS`: the config's
 *   `embedOrigins`, already checked to be https origins.
 */
export function storeHtmlFragment(
  html: string | null | undefined,
  document: Document = globalThis.document,
  embedOrigins: readonly string[] = [],
): DocumentFragment {
  const template = document.createElement('template');
  // A <template>'s content is parsed inert: nothing in it loads or runs before it is cleaned.
  // eslint-disable-next-line no-restricted-syntax -- parsing into an inert template is the sanctioned way in
  template.innerHTML = html ?? '';
  // The template itself is never inserted, so its own `style` is a free parser for the content's declarations.
  const page = pageOf(document, template, embedOrigins);
  // Document order: a replaced element's content moves up and is visited after it; what a removed one held leaves
  // the fragment with it.
  for (const element of [...template.content.querySelectorAll('*')]) cleanElement(element, page);
  return template.content;
}
