/**
 * Called by the core with the events it buffered while this part loaded; the queue then handles events as they come.
 *
 * @param pageLoads The body each `astro:page-load` in the queue came for.
 * @param landing The body of the page `init()` ran on.
 */
export declare function startAnalytics(queue: Event[], pageLoads: WeakMap<Event, HTMLElement>, landing: HTMLElement): Promise<void>;
