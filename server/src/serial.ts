/** Running async work one task at a time, in call order. Used by the sync engine and the request throttle. */

type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

/** The task's caller already holds its promise and handles the rejection; the queue only waits for it to settle. */
function leaveRejectionToCaller() {
  // Reported through the promise `enqueue` returned.
}

/** A queue whose tasks never overlap. A task that fails rejects its own caller only: the next task still runs. */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(() => task());
    tail = run.catch(leaveRejectionToCaller);
    return run;
  };
}
