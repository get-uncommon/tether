/**
 * Fails each test file that leaves a handle open (a server, socket, timer, child process or pending fs call), leaves
 * anything in the temp folder, or has a jsdom page throw an exception nothing catches. `npm test` runs the files with
 * `--test-force-exit`, which ends each file's process once its tests are done, so such a handle can't stall the run;
 * this module makes it fail the file instead of passing silently. `npm test` loads it twice:
 *
 * - with `--import`, into every test file's process, which it gives a temp folder of its own, and where it lists, as
 *   `--test-force-exit` ends the process, the handles still active other than the runner's own stdio pipes, what is
 *   left in that folder and the uncaught exceptions jsdom reported, on stderr, and exits with 1 when there are any;
 * - as a second `--test-reporter`, in the runner, where it gathers those lines and prints them together after the run.
 *
 * jsdom hands an exception a page's script or event listener throws, and nothing catches, only to the page's virtual
 * console, which prints it, or drops it when nothing listens, so the test that caused it would pass. jsdom's other
 * errors, such as "Not implemented: navigation", are left to the tests: a test that follows a link causes one.
 *
 * The reporter also names the tests still running when their file was ended: `--test-timeout` ends a file's process
 * once the whole file has run that long, and Node then names only the file.
 */
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  for (const exception of uncaughtInPages) report(`threw in a jsdom page: ${exception}`);
  exit(counts.size > 0 || left.length > 0 || uncaughtInPages.size > 0 ? 1 : code);
}

/** What {@link report} says about each uncaught exception a jsdom page in this process threw. */
const uncaughtInPages = new Set<string>();

/** The test files: a frame in one is where the test made the page throw. */
const TEST_FILE = /^(?:server\/)?test\//;

/**
 * @returns The `file:line:column` of each frame of `stack` in this repository's own files, relative to it, or in a
 *   script a page loaded from a URL, innermost first.
 */
function ownFrames(stack: string): string[] {
  const frames: string[] = [];
  for (const [, location = ''] of stack.matchAll(/^\s*at (?:.*\()?(\S+:\d+:\d+)\)?$/gm)) {
    if (location.startsWith('node:')) continue;
    if (/^https?:\/\//.test(location)) {
      frames.push(location);
      continue;
    }
    const path = relative(process.cwd(), location.startsWith('file:') ? fileURLToPath(location) : location);
    if (!path.startsWith('..') && !path.includes('node_modules')) frames.push(path.replaceAll('\\', '/'));
  }
  return frames;
}

/**
 * Notes a `jsdomError` a page's virtual console was given when it is an uncaught exception, with where it was thrown
 * and the test file line that led to it.
 */
function noteJsdomError(error: unknown): void {
  if (!(error instanceof Error) || Reflect.get(error, 'type') !== 'unhandled exception') return;
  const thrown: unknown = Reflect.get(error, 'detail');
  const stack: unknown = typeof thrown === 'object' && thrown !== null ? Reflect.get(thrown, 'stack') : undefined;
  const frames = typeof stack === 'string' ? ownFrames(stack) : [];
  const [thrownAt] = frames;
  const fromTest = frames.find((frame) => TEST_FILE.test(frame));
  const at = thrownAt === undefined ? '' : ` at ${thrownAt}`;
  const from = fromTest === undefined || fromTest === thrownAt ? '' : `, from ${fromTest}`;
  uncaughtInPages.add(`${error.message}${at}${from}`);
}

/**
 * Whether the exception jsdom is reporting comes from a window that was closed. jsdom's `close()` empties the body and
 * removes the document, and still runs the MutationObserver callbacks that emptying queues, which then throw; a
 * browser runs nothing of a closed window.
 */
let reportingForClosedWindow = false;

/**
 * Sends every `jsdomError` event of every jsdom page in this process to {@link noteJsdomError}, before the page's own
 * listeners, through the class jsdom builds each page's virtual console from, a test's own included, unless the page
 * was closed.
 */
function watchJsdomErrors(): void {
  const require = createRequire(import.meta.url);
  const virtualConsole: unknown = require('jsdom/lib/jsdom/virtual-console.js');
  const prototype: unknown = typeof virtualConsole === 'function' ? virtualConsole.prototype : undefined;
  if (!(prototype instanceof EventEmitter)) throw new Error("jsdom's VirtualConsole is not an EventEmitter");
  Object.defineProperty(prototype, 'emit', {
    value(this: EventEmitter, event: string | symbol, ...args: unknown[]) {
      if (event === 'jsdomError' && !reportingForClosedWindow) noteJsdomError(args[0]);
      return EventEmitter.prototype.emit.call(this, event, ...args);
    },
  });
  // jsdom reports each uncaught exception through this one function, with the window it came from. Each of jsdom's
  // modules that reports one requires it when it loads, after this, so each gets the wrapper from the module cache.
  const reporterPath = require.resolve('jsdom/lib/jsdom/living/helpers/runtime-script-errors.js');
  const reportException: unknown = require(reporterPath);
  const reporter = require.cache[reporterPath];
  if (typeof reportException !== 'function' || reporter === undefined) {
    throw new Error("jsdom's runtime-script-errors.js does not export its reportException");
  }
  reporter.exports = (window: unknown, ...args: unknown[]) => {
    reportingForClosedWindow =
      typeof window === 'object' && window !== null && Reflect.get(window, 'document') === undefined;
    try {
      Reflect.apply(reportException, undefined, [window, ...args]);
    } finally {
      reportingForClosedWindow = false;
    }
  };
}

// Only the runner's per-file child processes: the runner itself doesn't run `--import` modules, but loads this one as
// a reporter. `--test-force-exit` ends a child with `process.exit()` once its tests are done.
if (process.env['NODE_TEST_CONTEXT'] !== undefined) {
  // The file's own temp folder, for its process and every process it starts (`os.tmpdir()` reads these variables on
  // each call), so what is left there was left by this file's tests, not by another file running at the same time.
  const temp = mkdtempSync(join(tmpdir(), 'tether-test-'));
  for (const name of ['TMPDIR', 'TEMP', 'TMP']) process.env[name] = temp;
  watchJsdomErrors();
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

/** How long Git for Windows' bash may take to start, on a busy machine. */
const MSYS_START_TIMEOUT_MS = 30_000;

/** @returns Git for Windows' bash, or `undefined` for a git without Git for Windows' MSYS. */
export function msysBash(): string | undefined {
  // Git for Windows' exec path is <git>/mingw64/libexec/git-core; its MSYS programs are in <git>/usr/bin.
  const gitCore = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  const bash = join(gitCore, '..', '..', '..', 'usr', 'bin', 'bash.exe');
  return existsSync(bash) ? bash : undefined;
}

/**
 * Keeps Git for Windows' MSYS runtime running, started with this process's temp folder, until the returned function is
 * called or this process ends. Every MSYS program (Git's bash, sh and tar) shares one mount table, which the first of
 * them to start while none is running makes, with `/tmp` at that program's `TEMP`, and which lasts until the last of
 * them exits. Without this, a test's bash or tar, running with its file's temp folder, could be that first program,
 * and every other MSYS program on the machine, a shell in another terminal included, would then write its `/tmp`
 * files into that folder and fail the file.
 *
 * The running `bash` never keeps this process alive. One that fails to start, exits, or prints nothing within
 * `startTimeoutMs` is given up with a note on stderr, and the tests run without it.
 */
export async function holdMsysTemp(bash: string, startTimeoutMs = MSYS_START_TIMEOUT_MS): Promise<() => void> {
  // `read` returns once its input ends: when the returned function ends it, or when this process exits.
  const keeper = spawn(bash, ['--noprofile', '--norc', '-c', 'echo started; read -r _'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  /** Why `bash` is given up, or `undefined` once it has started. */
  const failure = await new Promise<string | undefined>((resolve) => {
    const timer = setTimeout(() => {
      resolve(`${bash} printed nothing in ${String(startTimeoutMs / 1000)} s`);
    }, startTimeoutMs);
    const settle = (outcome: string | undefined) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    keeper.stdout.once('data', () => {
      settle(undefined);
    });
    keeper.once('error', (error) => {
      settle(error.message);
    });
    keeper.once('exit', (code, signal) => {
      settle(`${bash} exited with ${String(code ?? signal)} before it started`);
    });
  });
  if (failure !== undefined) {
    keeper.kill();
    process.stderr.write(
      `test-leaks: running the tests without a bash holding the MSYS /tmp (${failure}): a test's bash or tar may map every MSYS program's /tmp into its file's temp folder\n`,
    );
    return () => {
      // No bash is running to release.
    };
  }
  // bash needs only its stdin pipe open, and none of it holds the event loop: a process whose reporter never finishes
  // still exits, which ends bash's `read`.
  keeper.stdout.destroy();
  keeper.unref();
  if (keeper.stdin instanceof Socket) keeper.stdin.unref();
  return () => {
    keeper.stdin.destroy();
  };
}

// The runner, which starts every test file's process: it loads this module only as a reporter, never through
// `--import`, which reaches only the test files' processes. A process given it through `--import` outside a test run
// has neither `NODE_TEST_CONTEXT` nor `--test`.
const runsTheTests = process.env['NODE_TEST_CONTEXT'] === undefined && process.execArgv.includes('--test');
const keeperBash = runsTheTests && process.platform === 'win32' ? msysBash() : undefined;
const releaseMsysTemp =
  keeperBash === undefined
    ? () => {
        // Only the runner on Windows, with Git for Windows' MSYS, has a bash to release.
      }
    : await holdMsysTemp(keeperBash);

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
  releaseMsysTemp();
  if (running.size > 0) {
    yield `\nStill running when their file was ended:\n`;
    for (const test of running.keys()) yield `  ${test}\n`;
  }
  if (leaks.size === 0) return;
  yield `\nWhat their tests left behind or let a jsdom page throw, which fails these test files:\n`;
  for (const leak of [...leaks].sort()) yield `  ${leak}\n`;
}
