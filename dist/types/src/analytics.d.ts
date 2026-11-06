/**
 * Called by the core with the events it buffered while this part loaded; the queue then handles events as they come.
 */
export declare function startAnalytics(queue: Event[]): Promise<void>;
