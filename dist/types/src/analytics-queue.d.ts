import type { Parts } from './lazy.js';
/**
 * The types of the events `mount()` and `unmount()` queue, from which the analytics part tells a page transition: a
 * new page in the same body, which starts a page view of its own. They are only queued, never dispatched.
 */
export declare const PAGE_MOUNT = "page-mount";
export declare const PAGE_LEFT = "page-left";
/** The event `mount(root)` queues. */
export type PageMount = CustomEvent<Document | Element>;
/**
 * Buffers the events the analytics part handles until `load` has the part, then hands it the buffer. When the part
 * fails to load (an ad blocker, a CSP rule, an integrity mismatch) or to start, the buffer is emptied, its listeners
 * removed and what is pushed to it dropped, so the page keeps no cart or product details for a part that will never
 * read them.
 *
 * Each `astro:page-load` is kept with the body it came for, and the part is given the landing page's body, so a
 * navigation made before the part loaded still counts both pages, and Astro's first `astro:page-load`, on the landing
 * page's body, counts none.
 *
 * @returns The buffer, which the part drains and then handles each event pushed to it as it comes.
 */
export declare function queueAnalyticsEvents(load: () => Promise<Pick<Parts['analytics'], 'startAnalytics'>>): Event[];
