/**
 * Spaces requests evenly (perMinute) and pushes them back after a 429. Webflow allows 60 requests a minute on
 * Starter/Basic site plans and 120 on CMS/eCommerce/Business, per API token. The default of 50 leaves room for the
 * Designer and other integrations.
 */
import { createSerialQueue } from './serial.js';
import { sleep as realSleep } from './util.js';

const MS_PER_MINUTE = 60000;

/**
 * @typedef {object} Throttle
 * @property {() => Promise<void>} wait Resolves when the caller may send its request. Calls are served in order.
 * @property {(ms: number) => void} pause Holds every request back for `ms`, after a 429.
 * @property {number} gap Milliseconds between two requests.
 */

/**
 * @param {{ perMinute?: number, sleep?: (ms: number) => Promise<void>, now?: () => number }} [options]
 * @returns {Throttle}
 */
export function createThrottle({ perMinute = 50, sleep = realSleep, now = () => Date.now() } = {}) {
  const gap = perMinute > 0 ? MS_PER_MINUTE / perMinute : 0;
  const enqueue = createSerialQueue();
  let next = 0;

  function wait() {
    return enqueue(async () => {
      const time = now();
      if (time < next) await sleep(next - time);
      next = Math.max(time, next) + gap;
    });
  }

  /** @param {number} ms */
  function pause(ms) {
    next = Math.max(next, now() + ms);
  }

  return { wait, pause, gap };
}
