// The update workflow the sync Worker ships. These tests read the shipped file, so they live outside server/: a
// deployed copy runs server/test/ against its own workflow, which is the one it was made with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  SHIPPED_REVISION,
  WORKFLOW_PATH,
  workflowRevision,
  workflowRevisionAt,
  workflowState,
} from '../server/scripts/workflow-check.ts';
import { asRecord, asString, fieldOf, listAt, numberAt, recordAt, stringAt } from '../server/test/mocks.js';

const SERVER = fileURLToPath(new URL('../server/', import.meta.url));
const shipped = () => readFile(join(SERVER, WORKFLOW_PATH), 'utf8');

/**
 * The shipped workflow's hash. A copy keeps the workflow it was made with, because an Action's token can't change a
 * workflow file, so every version of the updater keeps the contract that all shipped workflows rely on (the test
 * below). The hash makes a change to the workflow a deliberate one; a change that copies need also raises its
 * `# Tether workflow revision:` line, so the updater tells them to copy it in.
 */
const WORKFLOW_HASH = 'dd116510efb1';

test('the shipped workflow changes only on purpose', async () => {
  const hash = createHash('sha256').update(await shipped());
  assert.equal(hash.digest('hex').slice(0, 12), WORKFLOW_HASH);
});

test('the workflow keeps to the contract: the script path, the updated= line, test/ and src/entry.js', async () => {
  const workflow = await shipped();
  for (const command of [
    'node scripts/update-tether.mjs | tee update.log',
    `grep '^updated=' update.log | tail -1 | cut -d= -f2`,
    'node --test test/*.test.js',
    "import('./src/entry.js')",
  ]) {
    assert.ok(workflow.includes(command), command);
  }
});

/**
 * @typedef {{ name?: string, id?: string, uses?: string, run?: string, if?: string, env?: Record<string, string>,
 *   shell?: string, with?: Record<string, unknown> }} Step
 * @typedef {{ 'runs-on'?: string, 'timeout-minutes'?: number, permissions?: Record<string, string>,
 *   needs?: string | string[], if?: string, outputs?: Record<string, string>, steps: Step[] }} Job
 */

/**
 * Checks that `record` has only the keys these tests know, so a key the readers don't know (and would drop) fails
 * instead of escaping the checks on the parsed workflow.
 *
 * @param {Record<string, unknown>} record
 * @param {readonly string[]} known
 * @param {string} what
 */
function onlyKeys(record, known, what) {
  assert.deepEqual(
    Object.keys(record).filter((key) => !known.includes(key)),
    [],
    `${what} has only the keys these tests read`,
  );
}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {Record<string, string>}
 */
const stringsOf = (value, what) =>
  Object.fromEntries(
    Object.entries(asRecord(value, what)).map(([key, text]) => [key, asString(text, `${what}.${key}`)]),
  );

const STEP_TEXT = /** @type {const} */ (['name', 'id', 'uses', 'run', 'if', 'shell']);

/**
 * @param {unknown} value A step as the YAML parser read it.
 * @param {string} what
 * @returns {Step}
 */
function stepOf(value, what) {
  const read = asRecord(value, what);
  onlyKeys(read, [...STEP_TEXT, 'env', 'with'], what);
  /** @type {Step} */
  const step = {};
  for (const key of STEP_TEXT) if (key in read) step[key] = stringAt(read, key);
  if ('env' in read) step.env = stringsOf(read['env'], `${what}.env`);
  if ('with' in read) step.with = recordAt(read, 'with');
  return step;
}

/**
 * @param {unknown} value A job as the YAML parser read it.
 * @param {string} name
 * @returns {Job}
 */
function jobOf(value, name) {
  const read = asRecord(value, name);
  const known = ['runs-on', 'timeout-minutes', 'permissions', 'needs', 'if', 'outputs', 'steps'];
  onlyKeys(read, known, name);
  /** @type {Job} */
  const job = { steps: listAt(read, 'steps').map((step, i) => stepOf(step, `${name}.steps[${i}]`)) };
  if ('runs-on' in read) job['runs-on'] = stringAt(read, 'runs-on');
  if ('timeout-minutes' in read) job['timeout-minutes'] = numberAt(read, 'timeout-minutes');
  if ('permissions' in read) job.permissions = stringsOf(read['permissions'], `${name}.permissions`);
  if ('needs' in read) {
    const needs = read['needs'];
    job.needs = Array.isArray(needs)
      ? needs.map((need, i) => asString(need, `${name}.needs[${i}]`))
      : asString(needs, `${name}.needs`);
  }
  if ('if' in read) job.if = stringAt(read, 'if');
  if ('outputs' in read) job.outputs = stringsOf(read['outputs'], `${name}.outputs`);
  return job;
}

/** @returns {Promise<{ permissions: unknown, jobs: Record<string, Job> }>} The shipped workflow, checked as read. */
async function shippedJobs() {
  /** @type {unknown} */
  const workflow = parse(await shipped());
  const jobs = Object.fromEntries(
    Object.entries(recordAt(workflow, 'jobs')).map(([name, job]) => [name, jobOf(job, name)]),
  );
  return { permissions: fieldOf(workflow, 'permissions'), jobs };
}

/** The step that runs a command containing `command`, which exactly one step in the job may do. */
function stepRunning(/** @type {Job} */ job, /** @type {string} */ command) {
  const steps = job.steps.filter((step) => step.run?.includes(command));
  const [step, ...others] = steps;
  assert.ok(step && others.length === 0, command);
  return step;
}

/**
 * @param {Record<string, Job>} jobs
 * @param {string} name A job the workflow has.
 */
function jobNamed(jobs, name) {
  const job = jobs[name];
  assert.ok(job, `the workflow has a ${name} job`);
  return job;
}

const usesAction = (/** @type {Step} */ step, /** @type {string} */ action) =>
  step.uses?.startsWith(`${action}@`) === true;

/** Runs the release's code, or code a dependency install could bring in. */
const RUNS_RELEASE_CODE = /\b(?:node|npm|npx)\b/;

test('the workflow grants nothing by default, and each job only the permission it needs', async () => {
  const { permissions, jobs } = await shippedJobs();
  assert.deepEqual(permissions, {});
  assert.deepEqual(Object.keys(jobs).sort(), ['keep-alive', 'publish', 'update']);
  assert.deepEqual(jobs['keep-alive']?.permissions, { actions: 'write' });
  assert.deepEqual(jobs['update']?.permissions, { contents: 'read' });
  assert.deepEqual(jobs['publish']?.permissions, { contents: 'write' });
});

test('only publish waits for another job, the update, and only when it installed a release', async () => {
  const { jobs } = await shippedJobs();
  assert.equal(jobs['keep-alive']?.needs, undefined);
  assert.equal(jobs['update']?.needs, undefined);
  assert.deepEqual([jobs['publish']?.needs].flat(), ['update']);
  assert.equal(jobs['publish']?.if, "needs.update.outputs.version != ''");
});

test('every checkout leaves the token out of the git config, and every action is pinned by commit', async () => {
  const { jobs } = await shippedJobs();
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of job.steps) {
      if (step.uses === undefined) continue;
      assert.match(step.uses, /@[0-9a-f]{40}$/, `${name}: ${step.uses}`);
      if (usesAction(step, 'actions/checkout')) assert.equal(step.with?.['persist-credentials'], false, name);
    }
  }
});

test("only the read-only update job runs the release's code, its tests without a token", async () => {
  const { jobs } = await shippedJobs();
  const update = jobNamed(jobs, 'update');
  const tests = stepRunning(update, 'node --test test/*.test.js');
  assert.ok(tests.run?.includes("import('./src/entry.js')"));
  assert.equal(tests.env, undefined, 'the tests get no token');
  assert.doesNotMatch(JSON.stringify(tests), /github\.token|secrets\./);
  for (const name of ['keep-alive', 'publish']) {
    for (const step of jobNamed(jobs, name).steps) {
      assert.doesNotMatch(step.run ?? '', RUNS_RELEASE_CODE, `${name}: ${step.name ?? step.uses ?? ''}`);
    }
  }
});

test("the change is hashed and uploaded before the release's tests run", async () => {
  const { jobs } = await shippedJobs();
  const update = jobNamed(jobs, 'update');
  const at = (/** @type {Step} */ step) => update.steps.indexOf(step);
  const install = stepRunning(update, 'node scripts/update-tether.mjs');
  const record = stepRunning(update, 'git diff --cached --binary > "$RUNNER_TEMP/update.patch"');
  const uploads = update.steps.filter((step) => usesAction(step, 'actions/upload-artifact'));
  const tests = stepRunning(update, 'node --test test/*.test.js');
  const [upload, ...otherUploads] = uploads;
  assert.ok(upload && otherUploads.length === 0, 'one upload');
  assert.equal(upload.with?.['name'], 'tether-update');
  assert.ok(at(install) < at(record), 'the change is recorded after the release is installed');
  assert.ok(at(record) < at(upload) && at(upload) < at(tests), 'and recorded and uploaded before the tests run');
  assert.ok(record.run?.includes('sha256sum "$RUNNER_TEMP/update.patch"'));
  assert.equal(update.outputs?.['patch-sha256'], `\${{ steps.${String(record.id)}.outputs.sha256 }}`);
});

test("publish checks out the copy's own commit and applies the patch only after its hash matches", async () => {
  const { jobs } = await shippedJobs();
  const publish = jobNamed(jobs, 'publish');
  const [checkout, download, push, ...rest] = publish.steps;
  assert.equal(rest.length, 0, 'publish has three steps');
  assert.ok(checkout && usesAction(checkout, 'actions/checkout'));
  assert.deepEqual(Object.keys(checkout.with ?? {}), ['persist-credentials'], 'no other ref or repository');
  assert.ok(download && usesAction(download, 'actions/download-artifact'));
  assert.equal(download.with?.['name'], 'tether-update');
  assert.ok(push);
  assert.equal(push.env?.['PATCH_SHA256'], '${{ needs.update.outputs.patch-sha256 }}');
  const lines = (push.run ?? '').split('\n').map((line) => line.trim());
  const check = lines.indexOf('echo "$PATCH_SHA256  $RUNNER_TEMP/update.patch" | sha256sum --check --strict');
  const apply = lines.indexOf('git apply --index "$RUNNER_TEMP/update.patch"');
  assert.ok(check !== -1 && apply !== -1 && check < apply, 'the hash is checked before the patch is applied');
  assert.equal(push.shell, 'bash', 'bash -e: a failed check stops the step');
});

test('the updater knows the revision of the workflow it ships with', async () => {
  assert.equal(workflowRevision(await shipped()), SHIPPED_REVISION);
});

test('a copy made before 0.7.0 runs an outdated workflow and is told to copy the shipped one in', async () => {
  const fixture = await readFile(new URL('workflows/update-tether-v0.6.8.yml', import.meta.url), 'utf8');
  const copy = await mkdtemp(join(tmpdir(), 'tether-v068-'));
  await mkdir(join(copy, '.github', 'workflows'), { recursive: true });
  await writeFile(join(copy, WORKFLOW_PATH), fixture);
  assert.deepEqual(await workflowState(copy, await workflowRevisionAt(SERVER)), {
    kind: 'outdated',
    copy: 1,
    release: SHIPPED_REVISION,
  });
});
