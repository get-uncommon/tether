import type { Parts } from './lazy.js';
/**
 * The type of the event `mount()` queues for a container mounted after `unmount()`: a page transition, which keeps
 * the body, so it starts a page view of its own. It is only queued, never dispatched.
 */
export declare const PAGE_TRANSITION = "page-transition";
/**
 * Buffers the events the analytics part handles until `load` has the part, then hands it the buffer. When the part
 * fails to load (an ad blocker, a CSP rule, an integrity mismatch) or to start, the buffer is emptied and its
 * listeners removed, so the page keeps no cart or product details for a part that will never read them.
 *
 * Each `astro:page-load` is kept with the body it came for, and the part is given the landing page's body, so a
 * navigation made before the part loaded still counts both pages, and Astro's first `astro:page-load`, on the landing
 * page's body, counts none.
 *
 * @returns The buffer, which the part drains and then handles each event pushed to it as it comes.
 */
export declare function queueAnalyticsEvents(load: () => Promise<Pick<Parts['analytics'], 'startAnalytics'>>): Event[];
