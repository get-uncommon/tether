// `gh` for upgrade-from-released.test.js on Windows, where the updater's `spawnSync('gh', …)` (no shell) finds only
// an .exe or .com on the PATH, so a .cmd can't stand in for it. The test puts a copy of node.exe named gh.exe first
// on the PATH and loads this module into every Node process of the update through NODE_OPTIONS. In the updater it
// does nothing; in gh.exe it plays the one call the updater makes, `gh attestation verify <file> …`: it writes the
// arguments to TETHER_TEST_GH_LOG, one per line, and exits 0, as `gh` does for an attestation that verifies. Linux
// and macOS get a shell script that does the same.
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

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
