/**
 * The core's side of analytics: it buffers Tether's analytics events from `init()` on, until the analytics part has
 * loaded and takes them over, so none are missed.
 */
import { cfg, reportError } from './config.ts';
import { ANALYTICS_EVENTS } from './dom.ts';
import type { Parts } from './lazy.ts';

/**
 * Buffers the events the analytics part handles until `load` has the part, then hands it the buffer. When the part
 * fails to load (an ad blocker, a CSP rule, an integrity mismatch) or to start, the buffer is emptied and its
 * listeners removed, so the page keeps no cart or product details for a part that will never read them.
 *
 * @returns The buffer, which the part drains and then handles each event pushed to it as it comes.
 */
export function queueAnalyticsEvents(load: () => Promise<Pick<Parts['analytics'], 'startAnalytics'>>): Event[] {
  const queue: Event[] = [];
  // The window's own controller: a page's `addEventListener` takes only its own signals, and in jsdom those aren't
  // Node's.
  const listening = new window.AbortController();
  const options = { signal: listening.signal };
  ANALYTICS_EVENTS.forEach((name) => {
    document.addEventListener(`${cfg.prefix}:${name}`, (event) => queue.push(event), options);
  });
  document.addEventListener('astro:page-load', (event) => queue.push(event), options);
  load()
    .then((part) => part.startAnalytics(queue))
    .catch((error: unknown) => {
      listening.abort();
      queue.length = 0;
      reportError(error, 'analytics');
    });
  return queue;
}
