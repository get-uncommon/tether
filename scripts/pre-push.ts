/**
 * The pre-push hook's check (`.config/lefthook.yml`), which lefthook hands git's pushed refs on stdin: the whole gate,
 * `npm run check`, unless the push only adds commits that change only the Astro starter's package.json and lockfile
 * (`push-check.ts`). Run by hand, with no refs on stdin, it runs the whole gate.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTER_FILES, gitHistory, pushCheck } from './push-check.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The environment without the variables that tie git to a repository (GIT_DIR, GIT_INDEX_FILE, …, as git lists them).
 * Git sets them for a hook, and a test that runs git in a scratch repository would otherwise commit, configure and push
 * in this one: it has set core.bare and moved the branch before.
 */
function withoutHookRepository(): NodeJS.ProcessEnv {
  const names = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n');
  const env = { ...process.env };
  for (const name of names.filter(Boolean)) Reflect.deleteProperty(env, name);
  return env;
}

/** @returns The command's exit status. */
function run(command: string, args: readonly string[]): number {
  // On Windows npm and npx are batch files, which Node starts only through a shell; their arguments here are fixed
  // words and paths without spaces, so the shell has nothing to quote.
  const shell = process.platform === 'win32' && (command === 'npm' || command === 'npx');
  return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell, env: withoutHookRepository() }).status ?? 1;
}

// A terminal on stdin means a run by hand, with no refs to read.
const refs = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
const check = pushCheck(refs, gitHistory(ROOT));
if (check.kind === 'gate') {
  console.log(`pre-push: the whole gate (${check.reason})`);
  process.exitCode = run('npm', ['run', 'check']);
} else {
  console.log("pre-push: only the Astro starter's package files change: its version test and Prettier on them");
  const tested = run(process.execPath, ['--experimental-strip-types', '--test', 'test/versions.test.js']);
  const formatted = run('npx', ['prettier', '--check', ...STARTER_FILES]);
  process.exitCode = tested === 0 && formatted === 0 ? 0 : 1;
}
