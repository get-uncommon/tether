/** What the entry module does for a page. */
interface PageHooks {
    /** Settles once `init()` has applied the visitor's market. */
    ready: () => Promise<unknown>;
    mount: (root: Document) => unknown;
    unmount: () => void;
}
/**
 * Records a mount of the whole document, so the `astro:page-load` of the same page sends no second round of requests.
 */
export declare function rememberDocumentMount(): void;
/** Binds the document-wide listeners, once per page load of the script. */
export declare function bindNavigation(hooks: PageHooks): void;
export {};
