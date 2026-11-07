/**
 * Fails each test file that leaves a handle open (a server, socket, timer, child process or pending fs call) or leaves
 * anything in the temp folder. `npm test` runs the files with `--test-force-exit`, which ends each file's process once
 * its tests are done, so such a handle can't stall the run; this module makes it fail the file instead of passing
 * silently. `npm test` loads it twice:
 *
 * - with `--import`, into every test file's process, which it gives a temp folder of its own, and where it lists, as
 *   `--test-force-exit` ends the process, the handles still active other than the runner's own stdio pipes and what is
 *   left in that folder, on stderr, and exits with 1 when there are any;
 * - as a second `--test-reporter`, in the runner, where it gathers those lines and prints them together after the run.
 *
 * The reporter also names the tests still running when their file was ended: `--test-timeout` ends a file's process
 * once the whole file has run that long, and Node then names only the file.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { TestEvent } from 'node:test/reporters';

// Every test process forgets the repository a git hook points git at (GIT_DIR, GIT_INDEX_FILE, …): under the pre-push
// hook a test's `git init`, commits and pushes in a scratch repository would otherwise land in this one.
for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split('\n')) {
  if (name !== '') Reflect.deleteProperty(process.env, name);
}

const MARK = 'test-leaks: ';
const RUNNER_HANDLES = new Set(['PipeWrap', 'TTYWrap', 'CloseReq']);
/**
 * Turns of the event loop a handle a test closed may take to be gone: a closed server or socket stays active until
 * libuv has closed it, a few turns later.
 */
const CLOSING_TURNS = 20;

function openHandles(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const type of process.getActiveResourcesInfo()) {
    if (!RUNNER_HANDLES.has(type)) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

/** Hands the reporter one finding about this file, synchronously: the process ends right after it. */
function report(finding: string): void {
  writeSync(2, `${MARK}${relative(process.cwd(), process.argv[1] ?? '')} ${finding}\n`);
}

/**
 * Waits for the handles being closed to be gone, then reports them and what is left in `temp`, and exits as `exit`
 * would have.
 */
function exitOnceClosed(exit: (code?: number) => void, code: number | undefined, temp: string, turnsLeft: number) {
  const counts = openHandles();
  if (counts.size > 0 && turnsLeft > 0) {
    setImmediate(() => {
      exitOnceClosed(exit, code, temp, turnsLeft - 1);
    });
    return;
  }
  const left = readdirSync(temp).sort();
  if (counts.size > 0) {
    const handles = [...counts].map(([type, count]) => (count === 1 ? type : `${type} x${String(count)}`));
    report(`left open: ${handles.join(', ')}`);
  }
  if (left.length > 0) report(`left in the temp folder: ${left.join(', ')}`);
  exit(counts.size > 0 || left.length > 0 ? 1 : code);
}

// Only the runner's per-file child processes: the runner itself doesn't run `--import` modules, but loads this one as
// a reporter. `--test-force-exit` ends a child with `process.exit()` once its tests are done.
if (process.env['NODE_TEST_CONTEXT'] !== undefined) {
  // The file's own temp folder, for its process and every process it starts (`os.tmpdir()` reads these variables on
  // each call), so what is left there was left by this file's tests, not by another file running at the same time.
  const temp = mkdtempSync(join(tmpdir(), 'tether-test-'));
  for (const name of ['TMPDIR', 'TEMP', 'TMP']) process.env[name] = temp;
  // However the process ends: an uncaught exception ends it without the `process.exit()` below.
  process.on('exit', () => {
    rmSync(temp, { recursive: true, force: true });
  });
  const exit = process.exit.bind(process);
  Object.defineProperty(process, 'exit', {
    value: (code?: number) => {
      exitOnceClosed(exit, code, temp, CLOSING_TURNS);
    },
  });
}

/** A test the runner has started, by its file and name, indented by its depth. */
function runningTest({ file, nesting, name }: { file?: string | undefined; nesting: number; name: string }) {
  const path = relative(process.cwd(), file ?? '');
  // The runner runs each file as a test named after it.
  return name === path ? null : `${path}: ${'  '.repeat(nesting)}${name}`;
}

export default async function* leakReport(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  const leaks = new Set<string>();
  /** The started tests that have no result yet, with how many of each are running. */
  const running = new Map<string, number>();
  for await (const event of source) {
    if (event.type === 'test:stderr') {
      for (const line of event.data.message.split('\n')) {
        if (line.startsWith(MARK)) leaks.add(line.slice(MARK.length));
      }
      continue;
    }
    const started = event.type === 'test:dequeue';
    if (!started && event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const test = runningTest(event.data);
    if (test === null) continue;
    const count = (running.get(test) ?? 0) + (started ? 1 : -1);
    if (count > 0) running.set(test, count);
    else running.delete(test);
  }
  if (running.size > 0) {
    yield `\nStill running when their file was ended:\n`;
    for (const test of running.keys()) yield `  ${test}\n`;
  }
  if (leaks.size === 0) return;
  yield `\nWhat their tests left behind, which fails these test files:\n`;
  for (const leak of [...leaks].sort()) yield `  ${leak}\n`;
}
