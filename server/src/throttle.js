// @ts-nocheck
/**
 * Spaces requests evenly (perMinute) and retries 429s with Retry-After.
 * Webflow: 60 requests/min on Starter/Basic site plans, 120 on CMS/eCommerce/Business,
 * per API token. Default 50 leaves room for the Designer and other integrations.
 */
import { sleep as realSleep } from './util.js';

export function createThrottle({ perMinute = 50, sleep = realSleep, now = () => Date.now() } = {}) {
  const gap = perMinute > 0 ? 60000 / perMinute : 0;
  let next = 0;
  let chain = Promise.resolve();

  /** Resolves when the caller may send its request. Calls are serialised. */
  function wait() {
    const turn = chain.then(async () => {
      const t = now();
      if (t < next) await sleep(next - t);
      next = Math.max(t, next) + gap;
    });
    chain = turn.catch(() => {});
    return turn;
  }

  /** Push everything back, e.g. after a 429. */
  function pause(ms) { next = Math.max(next, now() + ms); }

  return { wait, pause, gap };
}
