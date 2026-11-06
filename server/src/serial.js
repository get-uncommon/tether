/** Running async work one task at a time, in call order. Used by the sync engine and the request throttle. */

/** @typedef {<T>(task: () => Promise<T>) => Promise<T>} SerialQueue */

/** The task's caller already holds its promise and handles the rejection; the queue only waits for it to settle. */
function leaveRejectionToCaller() {
  // Reported through the promise `enqueue` returned.
}

/**
 * A queue whose tasks never overlap. A task that fails rejects its own caller only: the next task still runs.
 *
 * @returns {SerialQueue}
 */
export function createSerialQueue() {
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();
  return function enqueue(task) {
    const run = tail.then(() => task());
    tail = run.catch(leaveRejectionToCaller);
    return run;
  };
}
