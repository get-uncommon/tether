/**
 * Writes a build's file through a temporary file beside it, so neither a core that hashes a part file in `--watch`
 * (build.ts) nor a browser loading one reads it half written.
 */
import { rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

/** The suffix of the temporary file `writeAtomically` writes, `<file>.tmp-<pid>`. */
export const TEMPORARY_SUFFIX = /\.tmp-\d+$/;

/**
 * The codes Windows fails a rename with while another handle has the file it replaces open. Elsewhere a rename
 * replaces an open file, and these codes mean a file mode, a read-only file system or a mount point, which waiting
 * doesn't change.
 */
const BUSY_CODES: ReadonlySet<unknown> = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 20;
const RENAME_RETRY_MS = 50;

/** @returns Whether a rename that failed with `error` on `platform` may succeed once another handle lets go. */
export function isBusyRename(error: unknown, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && error instanceof Error && 'code' in error && BUSY_CODES.has(error.code);
}

/**
 * Writes `file` through `<file>.tmp-<pid>`, renamed into its place. On Windows the rename fails while anything reads
 * the file, the core's own hashing included, so a busy file is retried, for up to about 10 seconds. An interrupted run
 * leaves the temporary file, which the next build's folder check counts as the build's own (`isBuildEntry` in
 * build.ts) and the build's folder swap removes.
 *
 * @throws The rename's error when it fails otherwise, or the file stays busy.
 */
export async function writeAtomically(file: string, contents: string | Uint8Array): Promise<void> {
  const temporary = `${file}.tmp-${String(process.pid)}`;
  await writeFile(temporary, contents);
  try {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(temporary, file);
        return;
      } catch (error) {
        if (!isBusyRename(error, process.platform) || attempt === RENAME_ATTEMPTS) throw error;
        await sleep(RENAME_RETRY_MS * attempt);
      }
    }
  } finally {
    // Gone after the rename; what a failed rename left otherwise.
    await rm(temporary, { force: true });
  }
}
