// `gh` for upgrade-from-released.test.js on Windows, where the updater's `spawnSync('gh', …)` (no shell) finds only
// an .exe or .com on the PATH, so a .cmd can't stand in for it. The test puts a copy of node.exe named gh.exe first
// on the PATH and loads this module into every Node process of the update through NODE_OPTIONS. In the updater it
// does nothing; in gh.exe it plays the one call the updater makes, `gh attestation verify <file> …`: it writes the
// arguments to TETHER_TEST_GH_LOG, one per line, and exits 0, as `gh` does for an attestation that verifies. Linux
// and macOS get a shell script that does the same.
import { writeFileSync } from 'node:fs';
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

if (basename(process.execPath).toLowerCase() === 'gh.exe') {
  // Node reads the first argument as its script, which it has already resolved to a path in the working folder.
  const args = [basename(process.argv[1] ?? ''), ...process.argv.slice(2)];
  const log = process.env['TETHER_TEST_GH_LOG'];
  if (!log || args[0] !== 'attestation' || args[1] !== 'verify') {
    process.stderr.write(`gh stub: unexpected gh ${args.join(' ')}\n`);
    process.exit(1);
  }
  writeFileSync(log, `${args.join('\n')}\n`);
  process.exit(0);
}

/**
 * Writes a `gh` into `dir` that answers the one call the 0.7 updaters make, `gh attestation verify …`, as `gh` does
 * for an attestation that verifies, and writes its arguments to the file `TETHER_TEST_GH_LOG` names, one per line. On
 * Linux and macOS it is a shell script. On Windows the updater's `spawnSync` finds only an .exe, so it is a copy of
 * node.exe that this module, loaded through `NODE_OPTIONS`, turns into the stand-in.
 *
 * @param {string} dir A folder for it.
 * @returns {Promise<string[]>} The Node options it needs in the update's processes.
 */
export async function installGhStub(dir) {
  await mkdir(dir, { recursive: true });
  if (process.platform === 'win32') {
    await copyFile(process.execPath, join(dir, 'gh.exe'));
    return [`--import=${import.meta.url}`];
  }
  const script = join(dir, 'gh');
  await writeFile(
    script,
    [
      '#!/bin/sh',
      '[ "$1 $2" = "attestation verify" ] || { echo "gh stub: unexpected gh $*" >&2; exit 1; }',
      `printf '%s\\n' "$@" > "$TETHER_TEST_GH_LOG"`,
      '',
    ].join('\n'),
  );
  await chmod(script, 0o755);
  return [];
}
