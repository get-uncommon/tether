type ProblemLevel = 'error' | 'warn';
export interface Problem {
    level: ProblemLevel;
    message: string;
    /** The element, described for people: `<div#id.class>`. */
    element?: string;
    /** The element itself, for the console. */
    el?: Element;
}
/**
 * @param value What the markup says.
 * @param options What Tether reads.
 * @param prefix Put before the suggestion, e.g. `tether-`.
 * @returns ` Did you mean "…"?` for an option close enough to `value`, else `''`.
 */
export declare function didYouMean(value: string, options: Iterable<string>, prefix?: string): string;
/** The markup problems in `root`, in page order per check. */
export declare function checkMarkup(root?: ParentNode): Problem[];
export {};
