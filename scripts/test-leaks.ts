/**
 * Names the handles each test file leaves open, which `--test-force-exit` would otherwise hide. That flag ends each
 * file's process once its tests are done, so a forgotten server, socket, timer or child process can't stall the run;
 * but such a test passes silently. `npm test` loads this module twice:
 *
 * - with `--import`, into every test file's process, where it lists, as that process exits, the active handles other
 *   than the runner's own stdio pipes and handles already closing, on stderr;
 * - as a second `--test-reporter`, in the runner, where it gathers those lines and prints them together after the run.
 *
 * It reports and doesn't fail the run: a pending fs request or a timer that jsdom or the code under test still holds
 * is a leak to fix, not a wrong result.
 */
import { writeSync } from 'node:fs';
import { relative } from 'node:path';
import type { TestEvent } from 'node:test/reporters';

const MARK = 'test-leaks: ';
const RUNNER_HANDLES = new Set(['PipeWrap', 'TTYWrap', 'CloseReq']);

// Only the runner's per-file child processes: the runner itself doesn't run `--import` modules, but loads this one as
// a reporter.
if (process.env['NODE_TEST_CONTEXT'] !== undefined) {
  process.on('exit', () => {
    const counts = new Map<string, number>();
    for (const type of process.getActiveResourcesInfo()) {
      if (!RUNNER_HANDLES.has(type)) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    if (counts.size === 0) return;
    const handles = [...counts].map(([type, count]) => (count === 1 ? type : `${type} x${String(count)}`));
    // A synchronous write: the process ends as soon as this handler returns.
    writeSync(2, `${MARK}${relative(process.cwd(), process.argv[1] ?? '')} left open: ${handles.join(', ')}\n`);
  });
}

export default async function* leakReport(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  const leaks = new Set<string>();
  for await (const event of source) {
    if (event.type !== 'test:stderr') continue;
    for (const line of event.data.message.split('\n')) {
      if (line.startsWith(MARK)) leaks.add(line.slice(MARK.length));
    }
  }
  if (leaks.size === 0) return;
  yield `\nOpen handles when their tests ended (--test-force-exit closed them), in ${String(leaks.size)} test files:\n`;
  for (const leak of [...leaks].sort()) yield `  ${leak}\n`;
}
