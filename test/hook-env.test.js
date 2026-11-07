// Under the pre-push hook git points every child process at this repository (GIT_DIR, GIT_INDEX_FILE, …). Tests that
// run git in a scratch repository must not inherit that: they once set core.bare and moved the branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const LEAKS = new URL('../scripts/test-leaks.ts', import.meta.url).href;

test("a test process doesn't see the repository a git hook sets", () => {
  const names = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  assert.ok(names.includes('GIT_DIR'), 'git names GIT_DIR');
  const hooked = Object.fromEntries(names.map((name) => [name, `set-by-hook-${name}`]));
  const seen = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--import',
      LEAKS,
      '-e',
      'console.log(JSON.stringify(Object.keys(process.env).filter((key) => key.startsWith("GIT_"))))',
    ],
    { encoding: 'utf8', env: { ...process.env, ...hooked }, timeout: 30_000 },
  );
  const left = /** @type {unknown} */ (JSON.parse(seen.trim().split('\n').at(-1) ?? '[]'));
  assert.ok(Array.isArray(left));
  for (const name of names) assert.ok(!left.includes(name), `${name} reaches the test process`);
});
