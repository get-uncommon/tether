/**
 * Keeps a `<script>` core's part hashes current while the build watches the sources (`watchAll` in build.ts). A core
 * embeds the hash of each part file of its kind, read from disk when it builds (`partIntegrityPlugin`), so a core that
 * built before a part rewrote its file carries a hash the browser refuses.
 */

/** A `sha384-…` Subresource Integrity hash by part file name. */
export type PartHashes = Readonly<Record<string, string>>;

const sameHashes = (embedded: PartHashes | undefined, current: PartHashes): boolean =>
  embedded !== undefined &&
  Object.keys(embedded).length === Object.keys(current).length &&
  Object.entries(current).every(([file, hash]) => embedded[file] === hash);

/**
 * Rebuilds a core until the hashes its latest build embedded are the part files' hashes. One rebuild isn't enough:
 * esbuild's `rebuild()` called while a build of the context runs resolves with that build's result, and that build
 * may have read a part file before the part rewrote it.
 *
 * @param rebuild The core context's `rebuild`.
 * @param embedded The hashes the core's latest build embedded, or `undefined` before its first.
 * @param current The part files' hashes now (`partHashes` in build.ts).
 * @throws The error of a rebuild that fails, or of reading the part files.
 */
export async function rebuildUntilCurrent(
  rebuild: () => Promise<unknown>,
  embedded: () => PartHashes | undefined,
  current: () => Promise<PartHashes>,
): Promise<void> {
  do {
    await rebuild();
  } while (!sameHashes(embedded(), await current()));
}
