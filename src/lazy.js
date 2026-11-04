/**
 * Optional parts that most pages never need, loaded on first use.
 * ESM / Node: dynamic import (bundlers split these into their own chunks).
 * The <script> build swaps this file for lazy-iife.js (see scripts/build.mjs).
 */
export const loadPart = (name) => (name === 'diagnose' ? import('./diagnose.js') : import('./markets-ui.js'));

// Only the <script> build shares its modules with separately loaded parts.
export const coreModules = undefined;
