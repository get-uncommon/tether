export declare const listSelector: () => string;
/** A mounted list: its root, and loading its products again (after a country switch, or back online). */
export interface MountedList {
    root: HTMLElement;
    /** Never rejects: a failure shows in the list's state and is reported. */
    load: () => Promise<void>;
}
/** @returns The list at `root`, in its loading state until its first load renders it. */
export declare function mountedList(root: HTMLElement): MountedList;
