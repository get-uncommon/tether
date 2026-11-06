/**
 * Spaces requests evenly (perMinute) and pushes them back after a 429. Webflow allows 60 requests a minute on
 * Starter/Basic site plans and 120 on CMS/eCommerce/Business, per API token. The default of 50 leaves room for the
 * Designer and other integrations.
 */
import { createSerialQueue } from './serial.ts';
import { sleep as realSleep } from './util.ts';

const MS_PER_MINUTE = 60000;

export interface Throttle {
  /** Resolves when the caller may send its request. Calls are served in order. */
  wait: () => Promise<void>;
  /** Holds every request back for `ms`, after a 429. */
  pause: (ms: number) => void;
  /** Milliseconds between two requests. */
  gap: number;
}

interface ThrottleOptions {
  perMinute?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function createThrottle({
  perMinute = 50,
  sleep = realSleep,
  now = () => Date.now(),
}: ThrottleOptions = {}): Throttle {
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

  function pause(ms: number) {
    next = Math.max(next, now() + ms);
  }

  return { wait, pause, gap };
}
