/**
 * CI's `dist` job: `node --experimental-strip-types scripts/dist-guard.ts BASE HEAD` fails when a commit in
 * `BASE..HEAD` changes dist/ and is not a release commit (`dist-commits.ts`).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distProblems, gitDistHistory } from './dist-commits.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  console.error('usage: dist-guard.ts BASE HEAD');
  process.exit(2);
}
const problems = distProblems(base, head, gitDistHistory(ROOT));
if (problems.length > 0) {
  for (const problem of problems) console.log(problem);
  console.log(
    '::error::these commits change dist/, which only a release commit does: drop their dist/ changes (git checkout origin/main -- dist/)',
  );
  process.exitCode = 1;
}
