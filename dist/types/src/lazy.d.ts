/**
 * Optional parts that most pages never need, loaded on first use. In the ESM and Node builds they are dynamic
 * imports, which bundlers split into their own chunks; the `<script>` build swaps this file for `lazy-iife.ts`
 * (scripts/build.ts).
 */
export interface Parts {
    diagnose: typeof import('./diagnose.js');
    markets: typeof import('./markets-ui.js');
    search: typeof import('./search.js');
    extras: typeof import('./extras.js');
    account: typeof import('./account.js');
    'account-pages': typeof import('./account-pages.js');
    analytics: typeof import('./analytics.js');
}
export type PartName = keyof Parts;
/**
 * What `window.Tether` carries for the `<script>` build's separately loaded parts, besides the API sites use. Left out
 * of the published `Tether` type.
 */
export interface TetherInternals {
    /** `coreModules`: the modules the parts use instead of bundling copies, in the `<script>` build only. */
    __core: unknown;
    /** Each part registers its module here when its file has loaded. */
    __parts: Partial<Parts>;
}
export declare const loadPart: <Name extends PartName>(name: Name) => Promise<Parts[Name]>;
/** Only the `<script>` build shares its modules with separately loaded parts. */
export declare const coreModules: undefined;
