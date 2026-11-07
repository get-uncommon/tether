/**
 * The pre-push hook's check (`.config/lefthook.yml`), which lefthook hands git's pushed refs on stdin: the whole gate,
 * `npm run check`, unless every pushed commit changes only the Astro starter's package.json and lockfile
 * (`push-check.ts`). Run by hand, with no refs on stdin, it runs the whole gate.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTER_FILES, pushCheck } from './push-check.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @returns The command's exit status. */
function run(command: string, args: readonly string[]): number {
  // On Windows npm and npx are batch files, which Node starts only through a shell; their arguments here are fixed
  // words and paths without spaces, so the shell has nothing to quote.
  const shell = process.platform === 'win32' && (command === 'npm' || command === 'npx');
  return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell }).status ?? 1;
}

/** The files each commit in `range` changes, merges against each parent, or `null` when git can't list them. */
function filesOf(range: string): string[] | null {
  const result = spawnSync('git', ['log', '--format=', '--name-only', '-m', range], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.split('\n').filter(Boolean);
}

// A terminal on stdin means a run by hand, with no refs to read.
const refs = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
const check = pushCheck(refs, filesOf);
if (check.kind === 'gate') {
  console.log(`pre-push: the whole gate (${check.reason})`);
  process.exitCode = run('npm', ['run', 'check']);
} else {
  console.log("pre-push: only the Astro starter's package files change: its version test and Prettier on them");
  const tested = run(process.execPath, ['--experimental-strip-types', '--test', 'test/versions.test.js']);
  const formatted = run('npx', ['prettier', '--check', ...STARTER_FILES]);
  process.exitCode = tested === 0 && formatted === 0 ? 0 : 1;
}
