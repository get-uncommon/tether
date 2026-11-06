// Runs a deployed sync copy's own update workflow (server/.github/workflows/update-tether.yml as the copy was made
// with it) the way GitHub Actions runs it on Ubuntu, for upgrade-from-released.test.js: each job checks the copy's
// repository out in a folder of its own, each `run:` step runs in bash with the shell options, variables and
// expressions GitHub gives it, artifacts pass between jobs through a folder, and the push goes to a local repository
// that stands in for the copy's own on GitHub. It runs only what the shipped workflows use, and fails on anything else,
// so a workflow that needs more can't pass by being half run.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { WORKFLOW_PATH } from '../server/scripts/workflow-check.ts';
import { asList, asRecord, asString, fieldOf } from '../server/test/mocks.js';

/** The deployed copy's own repository on GitHub. */
export const COPY_REPOSITORY = 'shop-owner/tether-sync';
/** The token GitHub gives the copy's workflow. */
const WORKFLOW_TOKEN = 'workflow-token';
/**
 * Node's options in every step: Node before 22.18 strips types only with the flag; the copy's workflow runs a Node 22
 * that does it by default.
 */
export const NODE_OPTIONS = ['--experimental-strip-types', '--no-warnings'];
/** The `id` of the step every revision of the workflow runs the updater in; the later steps read its output. */
export const UPDATE_STEP_ID = 'up';
/** The name every revision of the workflow gives the step that tests the new version and imports its entry. */
export const TEST_STEP = 'Test the new version before it goes live';
/** The job every revision of the workflow runs the updater in. */
const UPDATE_JOB = 'update';
/**
 * What re-enables the weekly schedule through GitHub's API, on the copy's own repository, which has no stand-in here:
 * a job from revision 2 of the workflow on, a step of the update job before.
 */
const KEEP_ALIVE = { job: 'keep-alive', step: 'Keep the weekly schedule alive' };

const run = promisify(execFile);

/** The name of the `PATH` variable in this process's environment, which Windows spells `Path`. */
const PATH_NAME = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';

/**
 * The bash the steps run in, as on GitHub's Ubuntu runners. On Windows it is Git for Windows' own: the `bash` on the
 * `PATH` there can be WSL's, and Git's, started without a login shell, keeps the `PATH` it is given.
 */
const BASH =
  process.platform === 'win32'
    ? join(
        execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(),
        '..',
        '..',
        '..',
        'usr',
        'bin',
        'bash.exe',
      )
    : 'bash';

/**
 * `PATH` for the steps, with `first` in front and this test's Node next, as setup-node puts it. On Windows, Windows'
 * own tar comes next: the GNU tar that Git for Windows puts on the `PATH` reads the `C:` of the absolute paths the 0.6
 * updaters pass it as a remote host. The tools the steps run (`tee`, `sha256sum`) come last, from Git for Windows'
 * bash. Deployed copies run on Linux.
 *
 * @param {string[]} first
 * @returns {Record<string, string>}
 */
export function workflowPath(first) {
  const system = process.platform === 'win32' ? [join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32')] : [];
  const tools = process.platform === 'win32' ? [dirname(BASH)] : [];
  const path = [...first, dirname(process.execPath), ...system, process.env[PATH_NAME] ?? '', ...tools];
  return { [PATH_NAME]: path.join(delimiter) };
}

/**
 * @param {string} path
 * @returns The path with forward slashes, which Git for Windows' bash and git read too.
 */
const slashed = (path) => path.replaceAll('\\', '/');

/**
 * @typedef {{ name?: string, id?: string, uses?: string, run?: string, if?: string, shell?: string,
 *   env: Record<string, string>, with: Record<string, string> }} Step
 * @typedef {{ needs: string[], if?: string, outputs: Record<string, string>, steps: Step[] }} Job
 */

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {Record<string, string>} The map, with each value as text, the way Actions passes `with:` and `env:`.
 */
function textMap(value, what) {
  if (value === undefined) return {};
  return Object.fromEntries(Object.entries(asRecord(value, what)).map(([key, text]) => [key, String(text)]));
}

/**
 * @param {Record<string, unknown>} record
 * @param {readonly string[]} known
 * @param {string} what
 */
function onlyKnownKeys(record, known, what) {
  const unknown = Object.keys(record).filter((key) => !known.includes(key));
  assert.deepEqual(unknown, [], `${what} has only the keys runWorkflow runs`);
}

const STEP_TEXT = ['name', 'id', 'uses', 'run', 'if', 'shell'];

/**
 * @param {unknown} value A step as the YAML parser read it.
 * @param {string} what
 * @returns {Step}
 */
function stepOf(value, what) {
  const step = asRecord(value, what);
  onlyKnownKeys(step, [...STEP_TEXT, 'env', 'with'], what);
  /** @type {Step} */
  const read = { env: textMap(step['env'], `${what}.env`), with: textMap(step['with'], `${what}.with`) };
  for (const key of STEP_TEXT) if (key in step) Object.assign(read, { [key]: asString(step[key], `${what}.${key}`) });
  return read;
}

/**
 * The jobs of a workflow file, in the order they are written, which is the order their `needs` allow.
 *
 * @param {string} text
 * @returns {Map<string, Job>}
 */
function workflowJobs(text) {
  /** @type {Map<string, Job>} */
  const jobs = new Map();
  for (const [name, value] of Object.entries(asRecord(fieldOf(parse(text), 'jobs'), 'jobs'))) {
    const job = asRecord(value, name);
    onlyKnownKeys(job, ['runs-on', 'timeout-minutes', 'permissions', 'needs', 'if', 'outputs', 'steps'], name);
    const needs = job['needs'] === undefined ? [] : [job['needs']].flat().map((need) => asString(need, 'needs'));
    const steps = asList(job['steps'], `${name}.steps`).map((step, i) => stepOf(step, `${name}.steps[${String(i)}]`));
    /** @type {Job} */
    const read = { needs, outputs: textMap(job['outputs'], `${name}.outputs`), steps };
    if ('if' in job) read.if = asString(job['if'], `${name}.if`);
    jobs.set(name, read);
  }
  return jobs;
}

/**
 * The value of an expression the workflows use: always a name. A step's or job's output that was never set is empty,
 * as on GitHub; any other name must be in `context`.
 *
 * @param {string} name
 * @param {Map<string, string>} context
 */
function valueOf(name, context) {
  const value = context.get(name);
  if (value !== undefined) return value;
  assert.match(name, /^(steps|needs)\.[\w-]+\.outputs\.[\w-]+$/, `the workflow reads ${name}, which runWorkflow lacks`);
  return '';
}

/**
 * @param {Record<string, string>} map
 * @param {Map<string, string>} context
 * @returns {Record<string, string>} The map with each `${{ name }}` in its values replaced by the name's value.
 */
function expanded(map, context) {
  /** @param {string} text */
  const expand = (text) =>
    text.replace(/\$\{\{\s*(\S+)\s*\}\}/g, (_match, /** @type {string} */ name) => valueOf(name, context));
  return Object.fromEntries(Object.entries(map).map(([key, text]) => [key, expand(text)]));
}

/**
 * Whether a step or job with this `if:` runs. Every revision of the workflow compares one output with the empty
 * string.
 *
 * @param {string | undefined} condition
 * @param {Map<string, string>} context
 */
function runs(condition, context) {
  if (condition === undefined) return true;
  const [, name = ''] =
    /^(\S+) != ''$/.exec(condition.trim()) ?? assert.fail(`if: ${condition} is not one runWorkflow reads`);
  return valueOf(name, context) !== '';
}

/**
 * @param {string} file A step's `GITHUB_OUTPUT`.
 * @returns {Promise<[string, string][]>} Its `name=value` lines.
 */
async function outputsIn(file) {
  if (!existsSync(file)) return [];
  const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  return lines.map((line) => {
    const equals = line.indexOf('=');
    assert.ok(equals > 0, `GITHUB_OUTPUT line ${line} is name=value`);
    return [line.slice(0, equals), line.slice(equals + 1)];
  });
}

/**
 * The copy's repository: `deployed` committed as its owner deployed it, and a bare clone that stands in for it on
 * GitHub. Git runs with its own settings only, so the commits and the patch don't depend on this machine's.
 *
 * @param {string} deployed
 * @param {string} work
 */
async function deployedRepository(deployed, work) {
  const origin = join(work, 'origin.git');
  const gitConfig = join(work, 'gitconfig');
  await mkdir(work, { recursive: true });
  await writeFile(gitConfig, '');
  const env = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_COUNT: '1',
    // The publish job pushes to the copy's repository on github.com with the workflow's token.
    GIT_CONFIG_KEY_0: `url.${slashed(origin)}.insteadOf`,
    GIT_CONFIG_VALUE_0: `https://x-access-token:${WORKFLOW_TOKEN}@github.com/${COPY_REPOSITORY}.git`,
  };
  /**
   * @param {string} cwd
   * @param {string[]} args
   */
  const git = (cwd, args) =>
    execFileSync('git', ['-c', 'user.name=Owner', '-c', 'user.email=owner@shop.test', ...args], {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    }).trim();
  git(deployed, ['init', '--quiet', '--initial-branch=main']);
  git(deployed, ['add', '-A']);
  git(deployed, ['commit', '--quiet', '-m', 'Deploy tether-sync']);
  git(work, ['clone', '--quiet', '--bare', deployed, origin]);
  return { origin, env, git };
}

/**
 * @typedef {{ origin: string, git: (cwd: string, args: string[]) => string, artifacts: string, checkout: string }} Runner
 */

/**
 * Does what a `uses:` step's action does, for the actions the workflows use.
 *
 * @param {string} action The action, without its version.
 * @param {Record<string, string>} inputs Its `with:`, expanded.
 * @param {Runner} runner
 */
async function runAction(action, inputs, { origin, git, artifacts, checkout }) {
  const folder = join(artifacts, inputs['name'] ?? '');
  switch (action) {
    case 'actions/checkout':
      git(dirname(checkout), ['clone', '--quiet', origin, checkout]);
      return;
    // The steps run this test's Node, which workflowPath puts on the PATH.
    case 'actions/setup-node':
      return;
    case 'actions/upload-artifact': {
      const file = inputs['path'] ?? '';
      assert.ok(existsSync(file), `${file} is there to upload`);
      await mkdir(folder, { recursive: true });
      await copyFile(file, join(folder, basename(file)));
      return;
    }
    case 'actions/download-artifact':
      await cp(folder, inputs['path'] ?? '', { recursive: true });
      return;
    default:
      assert.fail(`${action} is not an action runWorkflow runs`);
  }
}

/**
 * Runs a `run:` step in bash with GitHub's options for its shell on Linux: `bash -e {0}` without a `shell:`, and
 * `bash --noprofile --norc -eo pipefail {0}` with `shell: bash`.
 *
 * @param {string} script The step's `run:`.
 * @param {string | undefined} shell The step's `shell:`.
 * @param {{ label: string, file: string, cwd: string, env: NodeJS.ProcessEnv }} where `file` is where to write the
 *   script; its `GITHUB_OUTPUT` goes next to it.
 * @returns What it printed, and its outputs.
 */
async function runScript(script, shell, { label, file, cwd, env }) {
  assert.ok(shell === undefined || shell === 'bash', `${label}: shell ${String(shell)}`);
  const options = shell === 'bash' ? ['--noprofile', '--norc', '-eo', 'pipefail'] : ['-e'];
  const output = `${file}.output`;
  await writeFile(file, script);
  const result = await run(BASH, [...options, slashed(file)], {
    cwd,
    env: { ...env, GITHUB_OUTPUT: slashed(output) },
    maxBuffer: 16 * 1024 * 1024,
  }).catch((/** @type {unknown} */ error) =>
    assert.fail(`${label} failed:
${String(fieldOf(error, 'stdout'))}${String(fieldOf(error, 'stderr'))}`),
  );
  return { stdout: result.stdout, outputs: await outputsIn(output) };
}

/**
 * What a run of the workflow left: what each step printed, by its `id` or `name`; the job summary; the update job's
 * checkout; and the repository it pushed to, with git as the steps ran it.
 *
 * @typedef {{ logs: Map<string, string>, summary: string, copy: string, origin: string,
 *   git: (cwd: string, args: string[]) => string }} WorkflowRun
 */

/**
 * Runs the copy's own update workflow, the one in `deployed`, in a repository made from it.
 *
 * @param {string} deployed The copy's files, as its owner deployed them.
 * @param {string} work A folder for the repository, the jobs and the artifacts, which doesn't exist yet.
 * @param {Record<string, string>} updateEnv What the step that runs the updater has besides; the copy's tests run
 *   without it, as on GitHub.
 * @returns {Promise<WorkflowRun>}
 */
export async function runWorkflow(deployed, work, updateEnv) {
  const { origin, env: gitEnv, git } = await deployedRepository(deployed, work);
  const summary = join(work, 'summary.md');
  /** @type {NodeJS.ProcessEnv} */
  const base = {
    ...process.env,
    ...gitEnv,
    ...workflowPath([]),
    NODE_OPTIONS: NODE_OPTIONS.join(' '),
    GITHUB_REPOSITORY: COPY_REPOSITORY,
    GITHUB_REF_NAME: 'main',
    GITHUB_STEP_SUMMARY: slashed(summary),
  };
  // The copy's `node --test` would report to this test run instead of running on its own.
  delete base['NODE_TEST_CONTEXT'];
  /** @type {Map<string, string>} */
  const logs = new Map();
  /** @type {Map<string, string>} The `needs.<job>.outputs.<name>` of the jobs that ran. */
  const jobOutputs = new Map();
  /** @type {Set<string>} */
  const ran = new Set();
  for (const [name, job] of workflowJobs(await readFile(join(deployed, WORKFLOW_PATH), 'utf8'))) {
    if (name === KEEP_ALIVE.job) continue;
    for (const need of job.needs) assert.ok(ran.has(need), `${name} runs after ${need}`);
    if (!runs(job.if, jobOutputs)) continue;
    const runner = { origin, git, artifacts: join(work, 'artifacts'), checkout: join(work, 'jobs', name) };
    const temp = join(work, 'jobs', `${name}-temp`);
    await mkdir(temp, { recursive: true });
    const context = new Map([...jobOutputs, ['github.token', WORKFLOW_TOKEN], ['runner.temp', slashed(temp)]]);
    for (const [index, step] of job.steps.entries()) {
      if (step.name === KEEP_ALIVE.step || !runs(step.if, context)) continue;
      const label = step.id ?? step.name ?? `${name}.steps[${String(index)}]`;
      if (step.uses !== undefined) {
        await runAction(step.uses.slice(0, step.uses.indexOf('@')), expanded(step.with, context), runner);
        continue;
      }
      assert.ok(step.run !== undefined, `${label} runs something`);
      const extra = step.id === UPDATE_STEP_ID ? updateEnv : {};
      const env = { ...base, ...expanded(step.env, context), ...extra, RUNNER_TEMP: slashed(temp) };
      const file = join(temp, `${String(index)}.sh`);
      const result = await runScript(step.run, step.shell, { label, file, cwd: runner.checkout, env });
      logs.set(label, result.stdout);
      for (const [key, value] of result.outputs) context.set(`steps.${label}.outputs.${key}`, value);
    }
    ran.add(name);
    for (const [key, value] of Object.entries(expanded(job.outputs, context))) {
      jobOutputs.set(`needs.${name}.outputs.${key}`, value);
    }
  }
  const summaryText = existsSync(summary) ? await readFile(summary, 'utf8') : '';
  return { logs, summary: summaryText, copy: join(work, 'jobs', UPDATE_JOB), origin, git };
}
