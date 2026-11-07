/**
 * Gives the Astro starter the `.env` its build reads, before `npm run e2e:build` builds it: a copy of `.env.example`
 * when the starter has no `.env` yet, so a contributor's own `.env` is kept. A Node script rather than `test -f` and
 * `cp`, which cmd.exe, the shell npm runs scripts in on Windows, doesn't have.
 */
import { copyFile, constants } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STARTER = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'astro');

try {
  await copyFile(join(STARTER, '.env.example'), join(STARTER, '.env'), constants.COPYFILE_EXCL);
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  // The starter has its own `.env`, which is kept.
}
