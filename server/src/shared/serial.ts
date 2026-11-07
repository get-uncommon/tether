/**
 * Running async work one task at a time, in call order: the browser's cart changes, and the Worker's sync engine and
 * request throttle.
 */

/** Starts `task` once every task queued before it has settled. A failure rejects its own caller only. */
export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

const settled = () => undefined;

/** A queue whose tasks never overlap. */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    // The task's result, or failure, reaches its caller through `result`; the queue only waits for it to settle.
    tail = result.then(settled, settled);
    return result;
  };
}
