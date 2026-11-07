/**
 * The commit-msg hook's check (`.config/lefthook.yml`), run on the message file git hands the hook: the subject is a
 * capitalised summary in plain English, with no conventional-commit type, no closing full stop and at most
 * `MAX_SUBJECT` characters, and a body is set off from it by a blank line. Merge commits keep git's own subject, and
 * `fixup!` and `squash!` commits are folded into another before they land, so neither is checked.
 */
import { readFileSync } from 'node:fs';

/** The longest subject the history has is 118 characters; Prettier's print width is the limit. */
const MAX_SUBJECT = 120;
/** git's verbose-commit marker: it drops everything from this line on. */
const SCISSORS = '# ------------------------ >8 ------------------------';
const CONVENTIONAL_TYPE = /^(?:feat|fix|chore|docs|style|refactor|perf|tests?|build|ci|revert)(?:\([^)]*\))?!?:/;
/**
 * A subject may open in lower case with a name as written in the code: an identifier with a capital or a digit
 * (`requestTimeout`, `e2e`, `0.6`) or a tool's name as the area it changes (`lefthook: ...`).
 */
const CODE_NAME = /^\S*[A-Z0-9]|^[a-z][\w.-]*:\s/;

/** The message as git stores it: no comment lines, nothing after the scissors, no trailing blank lines. */
function cleaned(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const scissors = lines.indexOf(SCISSORS);
  const kept = (scissors === -1 ? lines : lines.slice(0, scissors)).filter((line) => !line.startsWith('#'));
  while (kept.length > 0 && kept.at(-1)?.trim() === '') kept.pop();
  while (kept.length > 0 && kept[0]?.trim() === '') kept.shift();
  return kept;
}

function problemsOf(text: string): string[] {
  const [subject = '', second] = cleaned(text);
  if (subject === '') return ['the message is empty'];
  if (/^(?:Merge |fixup! |squash! |amend! )/.test(subject)) return [];
  const problems: string[] = [];
  if (CONVENTIONAL_TYPE.test(subject)) {
    problems.push('the subject has a conventional-commit type: say what changed in plain English instead');
  } else if (!/^[A-Z0-9]/.test(subject) && !CODE_NAME.test(subject)) {
    problems.push('the subject starts with a capital letter, unless it opens with a name from the code');
  }
  if (subject.endsWith('.')) problems.push("the subject doesn't end with a full stop");
  if (subject.length > MAX_SUBJECT) {
    problems.push(`the subject is ${subject.length} characters: keep it to ${MAX_SUBJECT}`);
  }
  if (second !== undefined && second.trim() !== '') problems.push('a blank line separates the subject from the body');
  return problems;
}

const file = process.argv[2];
if (file === undefined) {
  console.error('commit-msg: usage: commit-msg.ts <message file>');
  process.exit(2);
}
const problems = problemsOf(readFileSync(file, 'utf8'));
for (const problem of problems) console.error(`commit-msg: ${problem}`);
if (problems.length > 0) process.exitCode = 1;
