import type { Parts } from './lazy.js';
/**
 * Buffers the events the analytics part handles until `load` has the part, then hands it the buffer. When the part
 * fails to load (an ad blocker, a CSP rule, an integrity mismatch) or to start, the buffer is emptied and its
 * listeners removed, so the page keeps no cart or product details for a part that will never read them.
 *
 * @returns The buffer, which the part drains and then handles each event pushed to it as it comes.
 */
export declare function queueAnalyticsEvents(load: () => Promise<Pick<Parts['analytics'], 'startAnalytics'>>): Event[];
