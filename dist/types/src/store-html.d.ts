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
/**
 * Store HTML as a fragment of content elements only.
 *
 * @param document The document the fragment is for.
 * @param embedOrigins Origins iframes may load from besides the video players in `EMBED_ORIGINS`: the config's
 *   `embedOrigins`, already checked to be https origins.
 */
export declare function storeHtmlFragment(html: string | null | undefined, document?: Document, embedOrigins?: readonly string[]): DocumentFragment;
