/**
 * Optional parts that most pages never need, loaded on first use. In the ESM and Node builds they are dynamic
 * imports, which bundlers split into their own chunks; the `<script>` build swaps this file for `lazy-iife.js`
 * (scripts/build.mjs).
 */

/**
 * @typedef {{
 *   diagnose: typeof import('./diagnose.js'),
 *   markets: typeof import('./markets-ui.js'),
 *   search: typeof import('./search.js'),
 *   extras: typeof import('./extras.js'),
 *   account: typeof import('./account.js'),
 *   'account-pages': typeof import('./account-pages.js'),
 *   analytics: typeof import('./analytics.js'),
 * }} Parts
 */
/** @typedef {keyof Parts} PartName */

/** @type {{ [Name in PartName]: () => Promise<Parts[Name]> }} */
const PARTS = {
  diagnose: () => import('./diagnose.js'),
  markets: () => import('./markets-ui.js'),
  search: () => import('./search.js'),
  extras: () => import('./extras.js'),
  account: () => import('./account.js'),
  'account-pages': () => import('./account-pages.js'),
  analytics: () => import('./analytics.js'),
};

/**
 * @template {PartName} Name
 * @param {Name} name
 * @returns {Promise<Parts[Name]>}
 */
export const loadPart = (name) => PARTS[name]();

/** Only the `<script>` build shares its modules with separately loaded parts. */
export const coreModules = undefined;
