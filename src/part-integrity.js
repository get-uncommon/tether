/**
 * The Subresource Integrity hash of each optional part's file, by file name. A page that pins the core script with
 * `integrity` then runs only the parts built with it. The build (scripts/build.mjs) puts the hashes of the parts it
 * built into the core in place of this module; from source and in watch mode the map is empty and parts load
 * unchecked.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PART_INTEGRITY = {};
