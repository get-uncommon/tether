/**
 * Running async work one task at a time, in call order: the browser's cart changes, and the Worker's sync engine and
 * request throttle.
 */
/** Starts `task` once every task queued before it has settled. A failure rejects its own caller only. */
export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;
/** A queue whose tasks never overlap. */
export declare function createSerialQueue(): SerialQueue;
