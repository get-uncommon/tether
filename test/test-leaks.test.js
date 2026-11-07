// scripts/test-leaks.ts in a test file's process: what the file's tests leave in the temp folder fails the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const LEAKS = new URL('../scripts/test-leaks.ts', import.meta.url).href;

/**
 * Runs `script` as a test file's process the runner starts, ending it with `process.exit(0)` as `--test-force-exit`
 * does.
 *
 * @param {string} script
 */
function testProcess(script) {
  const ended = `${script}; console.log(require('node:os').tmpdir()); process.exit(0);`;
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--import', LEAKS, '-e', ended],
    { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }, timeout: 30_000 },
  );
  return { status: result.status, stderr: result.stderr, temp: result.stdout.trim() };
}

test('a test process that leaves a folder in its temp folder fails, naming it, and the folder goes', () => {
  const { status, stderr, temp } = testProcess(
    "const { mkdtempSync } = require('node:fs'); mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'tether-left-'))",
  );
  assert.equal(status, 1);
  assert.match(stderr, /^test-leaks: .* left in the temp folder: tether-left-\w+$/m);
  assert.ok(!existsSync(temp), 'the temp folder of the process is removed');
});

test('a test process that removes what it made in the temp folder passes', () => {
  const { status, stderr, temp } = testProcess(
    "const { mkdtempSync, rmSync } = require('node:fs'); rmSync(mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'tether-kept-')), { recursive: true })",
  );
  assert.equal(status, 0, stderr);
  assert.ok(!existsSync(temp));
});
