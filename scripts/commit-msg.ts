/**
 * The commit-msg hook's check (`.config/lefthook.yml`), run on the message file git hands the hook: the subject is a
 * capitalised summary in plain English, with no conventional-commit type, no closing full stop and at most
 * `MAX_SUBJECT` characters, and a body is set off from it by a blank line. Merge commits keep git's own subject, and
 * `fixup!` and `squash!` commits are folded into another before they land, so neither is checked.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The longest subject the history has is 118 characters; Prettier's print width is the limit. */
const MAX_SUBJECT = 120;
/** What follows git's comment string on its verbose-commit marker: git drops everything from that line on. */
const SCISSORS = ' ------------------------ >8 ------------------------';
/** The characters git picks from for `core.commentChar=auto`, in its order. */
const AUTO_COMMENT_CHARS = '#;@!$%^&|:';
const CONVENTIONAL_TYPE = /^(?:feat|fix|chore|docs|style|refactor|perf|tests?|build|ci|revert)(?:\([^)]*\))?!?:/;
/**
 * A subject may open in lower case with a name as written in the code: an identifier with a capital or a digit
 * (`requestTimeout`, `e2e`, `0.6`) or a tool's name as the area it changes (`lefthook: ...`).
 */
const CODE_NAME = /^\S*[A-Z0-9]|^[a-z][\w.-]*:\s/;

/** A git setting of the repository the hook runs in, or `null` when it isn't set. */
function gitSetting(key: string): string | null {
  const result = spawnSync('git', ['config', '--get', key], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.replace(/\r?\n$/, '') : null;
}

/**
 * What starts git's comment lines in `lines`: `core.commentString`, or `core.commentChar`, or `#`. With `auto`, git
 * takes the first of {@link AUTO_COMMENT_CHARS} that starts no line of the message it is given, and writes its comments
 * after that message: the last line that starts with one of them is git's.
 */
function commentPrefix(lines: readonly string[]): string {
  const setting = gitSetting('core.commentString') ?? gitSetting('core.commentChar') ?? '#';
  if (setting !== 'auto') return setting;
  const last = lines.findLast((line) => line !== '' && AUTO_COMMENT_CHARS.includes(line.charAt(0)));
  return last === undefined ? '#' : last.charAt(0);
}

/** The message as git stores it: no comment lines, nothing after the scissors, no leading or trailing blank lines. */
function cleaned(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const comment = commentPrefix(lines);
  const scissors = lines.indexOf(`${comment}${SCISSORS}`);
  const kept = (scissors === -1 ? lines : lines.slice(0, scissors)).filter((line) => !line.startsWith(comment));
  const first = kept.findIndex((line) => line.trim() !== '');
  const last = kept.findLastIndex((line) => line.trim() !== '');
  return first === -1 ? [] : kept.slice(first, last + 1);
}

/** The rules the message breaks, each said as what the message must do. */
function problemsOf(text: string): string[] {
  const [subject = '', second] = cleaned(text);
  if (subject === '') return ['the message must not be empty'];
  if (/^(?:Merge |fixup! |squash! |amend! )/.test(subject)) return [];
  const problems: string[] = [];
  if (CONVENTIONAL_TYPE.test(subject)) {
    problems.push('the subject must not start with a conventional-commit type: say what changed in plain English');
  } else if (!/^[A-Z0-9]/.test(subject) && !CODE_NAME.test(subject)) {
    problems.push('the subject must start with a capital letter, unless it opens with a name from the code');
  }
  if (subject.endsWith('.')) problems.push('the subject must not end with a full stop');
  if (subject.length > MAX_SUBJECT) {
    problems.push(`the subject must be at most ${String(MAX_SUBJECT)} characters; it is ${String(subject.length)}`);
  }
  if (second !== undefined && second.trim() !== '') {
    problems.push('a blank line must separate the subject from the body');
  }
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
