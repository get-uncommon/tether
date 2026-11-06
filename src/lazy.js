// @ts-nocheck
/**
 * Optional parts that most pages never need, loaded on first use.
 * ESM / Node: dynamic import (bundlers split these into their own chunks).
 * The <script> build swaps this file for lazy-iife.js (see scripts/build.mjs).
 */
const PARTS = {
  diagnose: () => import('./diagnose.js'),
  markets: () => import('./markets-ui.js'),
  search: () => import('./search.js'),
  extras: () => import('./extras.js'),
  account: () => import('./account.js'),
  'account-pages': () => import('./account-pages.js'),
  analytics: () => import('./analytics.js'),
};
export const loadPart = (name) => PARTS[name]();

// Only the <script> build shares its modules with separately loaded parts.
export const coreModules = undefined;
