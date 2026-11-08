// The commit-msg hook (scripts/commit-msg.ts), run as lefthook runs it, on message files: messages from the history and
// the release script's own pass, and the styles the history doesn't use fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isolatedGitEnv } from './fixtures.js';

const SCRIPT = fileURLToPath(new URL('../scripts/commit-msg.ts', import.meta.url));
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

/**
 * @param {string} message
 * @param {Record<string, string>} [config] The git settings the hook runs with, none of this machine's.
 * @returns The script's exit code and what it wrote to stderr.
 */
async function check(message, config = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'tether-commit-msg-'));
  try {
    const file = join(folder, 'COMMIT_EDITMSG');
    await writeFile(file, message);
    await promisify(execFile)(process.execPath, ['--experimental-strip-types', SCRIPT, file], {
      env: { ...process.env, ...isolatedGitEnv(config) },
    });
    return { code: 0, stderr: '' };
  } catch (error) {
    const { code, stderr } = /** @type {{ code: number, stderr: string }} */ (error);
    return { code, stderr };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Runs every message through the script at once, since each run starts Node. */
const checkAll = (/** @type {string[]} */ messages) => Promise.all(messages.map((message) => check(message)));

test('messages from the history pass', async () => {
  const messages = [
    `Retry waits stop at 30 s and retries at 10; any link target but the same tab gets noopener

- The retry wait doubles up to 30 s, and \`retries\` above 10 is refused with the usual warning: with
  retries: 50 the doubling passed the timer maximum and the later retries went out back to back.

${TRAILER}
`,
    `Release: rehearsal enforced, survives main moving; updater requests time out; a starter-lock push skips the full gate\n\n${TRAILER}\n`,
    "Long login addresses fit their cookie; ACCOUNT_SECRET can't be SYNC_SECRET; typed account operations; workflow linters\n",
    'requestTimeout works in Safari 15.4-15.6: a timer, not AbortSignal.timeout\n',
    "e2e: CI's report names a test that passed on its retry as flaky\n",
    "0.6 copies on latest: say so, keep them working; the update's patch can't be changed by the tests\n",
    "lefthook: don't warn about staged files ESLint deliberately ignores\n",
    'Docs: release order and maintenance releases, cart-updated reasons, query() answers; 0.7.3 notes\n',
    'Merge pull request #17 from ravi-klaassens/claude/parts-exact-version\n\nA core loaded from a jsDelivr range loads its parts from its exact release folder\n',
    "Merge remote-tracking branch 'origin/main' into claude/round-16\n\n# Conflicts:\n#\tCHANGELOG.md\n",
  ];
  for (const [index, result] of (await checkAll(messages)).entries()) {
    assert.deepEqual(result, { code: 0, stderr: '' }, messages[index]);
  }
});

test("the release script's commits pass", async () => {
  const messages = ['Tether 0.9.1', 'Tether 1.0.0-rc.1', 'Lock Tether 0.9.1 in the Astro starter'];
  for (const [index, result] of (await checkAll(messages.map((subject) => `${subject}\n`))).entries()) {
    assert.deepEqual(result, { code: 0, stderr: '' }, messages[index]);
  }
});

test("git's comments and the verbose diff aren't part of the message", async () => {
  const message = `Cart lines keep their order

# Please enter the commit message for your changes.
# ------------------------ >8 ------------------------
diff --git a/src/cart.ts b/src/cart.ts
`;
  assert.deepEqual(await check(message), { code: 0, stderr: '' });
});

test('styles the history does not use fail, each with what to change', async () => {
  const cases = /** @type {const} */ ([
    ['feat: add a cart drawer\n', 'conventional-commit type'],
    ['fix(cart): keep line order\n', 'conventional-commit type'],
    ['add a cart drawer\n', 'capital letter'],
    ['Cart lines keep their order.\n', 'full stop'],
    [`${'A'.repeat(121)}\n`, 'at most 120 characters; it is 121'],
    ['Cart lines keep their order\nThe body starts on the next line.\n', 'blank line'],
    ['\n# only a comment\n', 'empty'],
  ]);
  const results = await checkAll(cases.map(([message]) => message));
  for (const [index, { code, stderr }] of results.entries()) {
    const [message, problem] = cases[index] ?? ['', ''];
    assert.equal(code, 1, message);
    assert.match(stderr, new RegExp(problem), message);
  }
});

test("git's comment lines start with core.commentChar, which may be auto", async () => {
  const comments = (/** @type {string} */ char) =>
    `${char} Please enter the commit message for your changes.\n${char}\n`;
  const subject = 'Cart lines keep their order\n';
  const semicolon = { 'core.commentChar': ';' };
  assert.deepEqual(await check(`${subject}${comments(';')}`, semicolon), { code: 0, stderr: '' });
  assert.match((await check(`${subject}${comments('#')}`, semicolon)).stderr, /blank line/, '# starts the body here');
  const scissors = `Cart lines keep their order.\n; ------------------------ >8 ------------------------\nBody\n`;
  assert.match((await check(scissors, semicolon)).stderr, /must not end with a full stop/);

  // With auto, git picks the first character that starts no line of the message, and comments after it.
  const auto = { 'core.commentChar': 'auto' };
  assert.deepEqual(await check(`${subject}\n#1 in the issue list\n${comments(';')}`, auto), { code: 0, stderr: '' });
  assert.deepEqual(await check(`${subject}${comments('#')}`, auto), { code: 0, stderr: '' });
});

test('each problem says what the message must do', async () => {
  const { stderr } = await check('feat: cart lines keep their order.\nNo blank line.\n');
  assert.deepEqual(
    stderr.split('\n').filter((line) => line.startsWith('commit-msg: ')),
    [
      'commit-msg: the subject must not start with a conventional-commit type: say what changed in plain English',
      'commit-msg: the subject must not end with a full stop',
      'commit-msg: a blank line must separate the subject from the body',
    ],
  );
});
