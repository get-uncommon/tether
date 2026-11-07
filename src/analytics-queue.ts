/**
 * The core's side of analytics: it buffers Tether's analytics events from `init()` on, until the analytics part has
 * loaded and takes them over, so none are missed.
 */
import { cfg, reportError } from './config.ts';
import { ANALYTICS_EVENTS } from './dom.ts';
import type { Parts } from './lazy.ts';

/**
 * The type of the event `mount()` queues for a container mounted after `unmount()`: a page transition, which keeps
 * the body, so it starts a page view of its own. It is only queued, never dispatched.
 */
export const PAGE_TRANSITION = 'page-transition';

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
export function queueAnalyticsEvents(load: () => Promise<Pick<Parts['analytics'], 'startAnalytics'>>): Event[] {
  const queue: Event[] = [];
  const bodies = new WeakMap<Event, HTMLElement>();
  const landing = document.body;
  const queuePageLoad = (event: Event) => {
    bodies.set(event, document.body);
    queue.push(event);
  };
  // The window's own controller: a page's `addEventListener` takes only its own signals, and in jsdom those aren't
  // Node's.
  const listening = new window.AbortController();
  const options = { signal: listening.signal };
  ANALYTICS_EVENTS.forEach((name) => {
    document.addEventListener(`${cfg.prefix}:${name}`, (event) => queue.push(event), options);
  });
  document.addEventListener('astro:page-load', queuePageLoad, options);
  load()
    .then((part) => part.startAnalytics(queue, bodies, landing))
    .catch((error: unknown) => {
      listening.abort();
      queue.length = 0;
      reportError(error, 'analytics');
    });
  return queue;
}
