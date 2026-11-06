/**
 * Optional parts that most pages never need, loaded on first use. In the ESM and Node builds they are dynamic
 * imports, which bundlers split into their own chunks; the `<script>` build swaps this file for `lazy-iife.ts`
 * (scripts/build.ts).
 */

export interface Parts {
  diagnose: typeof import('./diagnose.ts');
  markets: typeof import('./markets-ui.ts');
  search: typeof import('./search.ts');
  extras: typeof import('./extras.ts');
  account: typeof import('./account.ts');
  'account-pages': typeof import('./account-pages.ts');
  analytics: typeof import('./analytics.ts');
}
export type PartName = keyof Parts;

const PARTS: { [Name in PartName]: () => Promise<Parts[Name]> } = {
  diagnose: () => import('./diagnose.ts'),
  markets: () => import('./markets-ui.ts'),
  search: () => import('./search.ts'),
  extras: () => import('./extras.ts'),
  account: () => import('./account.ts'),
  'account-pages': () => import('./account-pages.ts'),
  analytics: () => import('./analytics.ts'),
};

export const loadPart = <Name extends PartName>(name: Name): Promise<Parts[Name]> => PARTS[name]();

/** Only the `<script>` build shares its modules with separately loaded parts. */
export const coreModules = undefined;
