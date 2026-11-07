/**
 * Replaces a folder with a newly written one, so a step that fails, a rename the system refuses (Windows answers
 * EBUSY or EPERM for a folder a program holds open) or an interrupted run never leaves it half written or half
 * deleted. The build uses it for its output folder (`build.ts`).
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Writes a new folder next to `out`, then puts it in `out`'s place once `write` has succeeded: the old folder is
 * renamed aside, the new one renamed in, and only then is the old one removed. When the second rename fails, the old
 * folder is renamed back. The new and the old folder are `out`'s siblings, `.<name>-building-XXXXXX` and
 * `.<name>-building-XXXXXX-previous`: on the same volume, so renaming them is atomic, and at `out`'s depth, so the
 * relative paths a source map holds stay right. An interrupted run leaves them behind, which the repository's ignore
 * files cover for dist/ and .test-dist/.
 *
 * @param write Writes the new folder's files into the empty folder it is given.
 * @param move Renames a folder: `rename`, or a stand-in in the tests.
 */
export async function replaceFolder(
  out: string,
  write: (folder: string) => Promise<void>,
  move: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  const next = await mkdtemp(join(dirname(out), `.${basename(out)}-building-`));
  const previous = `${next}-previous`;
  try {
    await write(next);
    const replacing = existsSync(out);
    if (replacing) await move(out, previous);
    try {
      await move(next, out);
    } catch (error) {
      if (replacing) await move(previous, out);
      throw error;
    }
    await rm(previous, { recursive: true, force: true });
  } finally {
    // Gone after the swap; what a failed step left otherwise.
    await rm(next, { recursive: true, force: true });
  }
}
