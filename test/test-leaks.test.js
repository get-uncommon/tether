// scripts/test-leaks.ts in a test file's process, and the MSYS bash the runner holds on Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { msysBash } from '../scripts/test-leaks.ts';

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

test('a test process whose jsdom page throws an exception nothing catches fails, naming it, whatever its console', () => {
  const { status, stderr } = testProcess(
    "const { JSDOM, VirtualConsole } = require('jsdom'); const { window } = new JSDOM('<button></button>', { virtualConsole: new VirtualConsole() }); const button = window.document.querySelector('button'); button.addEventListener('click', () => { button.scrollIntoView(); }); button.click()",
  );
  assert.equal(status, 1);
  assert.match(
    stderr,
    /^test-leaks: .* threw in a jsdom page: Uncaught \[TypeError: button\.scrollIntoView is not a function\]/m,
  );
});

test("a test process whose jsdom page follows a link jsdom can't navigate, or handles its own error, passes", () => {
  const { status, stderr } = testProcess(
    "const { JSDOM } = require('jsdom'); const { window } = new JSDOM('<a href=\"https://other.test/\">x</a>', { url: 'https://site.test/' }); window.document.querySelector('a').click(); window.addEventListener('error', (event) => { event.preventDefault(); }); window.document.body.addEventListener('click', () => { throw new Error('handled'); }); window.document.body.click()",
  );
  assert.equal(status, 0, stderr);
  assert.match(stderr, /Not implemented: navigation/);
});

test('a test process whose jsdom page throws only once it was closed passes', () => {
  const { status, stderr } = testProcess(
    "const { JSDOM } = require('jsdom'); const { window } = new JSDOM('<p>x</p>'); new window.MutationObserver(() => window.document.body).observe(window.document.body, { childList: true }); window.close()",
  );
  assert.equal(status, 0, stderr);
});

/** Longer than a process that loads scripts/test-leaks.ts takes to exit, shorter than a hang. */
const EXIT_TIMEOUT_MS = 15_000;

/**
 * Runs a process outside any test run that loads scripts/test-leaks.ts with `args`, and waits for it to exit.
 *
 * @param {string[]} args
 */
function outsideTestRun(args) {
  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', ...args], {
    encoding: 'utf8',
    env,
    timeout: EXIT_TIMEOUT_MS,
  });
  assert.equal(result.signal, null, `still running after ${String(EXIT_TIMEOUT_MS / 1000)} s: ${result.stderr}`);
  return result;
}

/**
 * Starts `bash` as the runner's MSYS keeper in a process of its own, which never releases it.
 *
 * @param {string} bash
 * @param {number} [startTimeoutMs]
 */
function holdMsysTempIn(bash, startTimeoutMs) {
  const script = `const { holdMsysTemp } = await import(${JSON.stringify(LEAKS)}); await holdMsysTemp(${JSON.stringify(bash)}, ${String(startTimeoutMs)}); console.log('returned');`;
  return outsideTestRun(['--input-type=module', '-e', script]);
}

test('a process given it through --import outside a test run exits once its script has run', () => {
  const { status, stdout, stderr } = outsideTestRun(['--import', LEAKS, '-e', "console.log('hi')"]);
  assert.equal(status, 0, stderr);
  assert.equal(stdout, 'hi\n');
});

const bash = msysBash() ?? '/bin/bash';

test(
  'the bash holding the MSYS /tmp never keeps its process alive',
  { skip: existsSync(bash) ? false : 'no bash on this machine' },
  () => {
    const { status, stdout, stderr } = holdMsysTempIn(bash);
    assert.equal(status, 0, stderr);
    assert.equal(stdout, 'returned\n');
    assert.equal(stderr, '');
  },
);

test("a bash that can't start is given up with a note, and the tests run without it", () => {
  const { status, stdout, stderr } = holdMsysTempIn(join(tmpdir(), 'no-such-bash.exe'));
  assert.equal(status, 0, stderr);
  assert.equal(stdout, 'returned\n');
  assert.match(stderr, /^test-leaks: running the tests without a bash holding the MSYS \/tmp \(spawn .*ENOENT\)/);
});

test('a bash that prints nothing in time is given up with a note, and the tests run without it', () => {
  const { status, stdout, stderr } = holdMsysTempIn(process.execPath, 0);
  assert.equal(status, 0, stderr);
  assert.equal(stdout, 'returned\n');
  assert.match(
    stderr,
    /^test-leaks: running the tests without a bash holding the MSYS \/tmp \(.* printed nothing in 0 s\)/,
  );
});
