/**
 * The Subresource Integrity hash of each optional part's file, by file name, so the core loads only the parts built
 * with it (src/lazy-iife.js). Every `<script>` build, watch mode included, puts the hashes of the parts it built into
 * the core in place of this module (scripts/build.mjs); the empty map here only lets the source type-check, and a part
 * missing from the map is not loaded.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PART_INTEGRITY = {};
