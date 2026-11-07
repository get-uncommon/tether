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
export declare function createSerialQueue(): SerialQueue;
