/**
 * Running async work one task at a time, in call order: the browser's cart changes, and the Worker's sync engine and
 * request throttle.
 */

export interface SerialQueue {
  /** Starts `task` once every task queued before it has settled. A failure rejects its own caller only. */
  <T>(task: () => Promise<T>): Promise<T>;
  /** True while no task is waiting or running. */
  idle: () => boolean;
}

/** A queue whose tasks never overlap. */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  // The task's result, or failure, reaches its caller through the promise the queue returned; the queue only counts it.
  const settled = () => {
    pending--;
  };
  const run = <T>(task: () => Promise<T>): Promise<T> => {
    pending++;
    const result = tail.then(task);
    tail = result.then(settled, settled);
    return result;
  };
  return Object.assign(run, { idle: () => !pending });
}
