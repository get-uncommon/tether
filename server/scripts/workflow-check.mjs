/**
 * Tells the owner of a copy when its update workflow is older than the release being installed. GitHub doesn't let a
 * workflow's token change workflow files, so an update never replaces `.github/workflows/update-tether.yml`: a copy
 * keeps the workflow it was made with until a person copies the new one in.
 *
 * Copies may edit their workflow (the README suggests a daily `cron`), so the files are not compared byte for byte.
 * The shipped workflow carries a `# Tether workflow revision: N` line instead, raised whenever a copy needs the new
 * file; a workflow without that line is revision 1.
 */
import { readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {{ kind: 'current' } | { kind: 'outdated', copy: number, release: number } | { kind: 'not-compared' }} WorkflowState */

/** Where the workflow lives, in the copy and in a release's `server/` folder alike. */
export const WORKFLOW_PATH = '.github/workflows/update-tether.yml';

const REVISION_LINE = /^# Tether workflow revision: (\d+)\s*$/m;
const FIRST_REVISION = 1;

/**
 * @param {string} workflow The workflow file's text.
 * @returns {number}
 */
export function workflowRevision(workflow) {
  const revision = REVISION_LINE.exec(workflow)?.[1];
  return revision === undefined ? FIRST_REVISION : Number(revision);
}

/**
 * @param {string} copyRoot
 * @param {string} releaseRoot The release's `server/` folder.
 * @returns {Promise<WorkflowState>} `not-compared` when either has no workflow (a copy run by hand, without Actions).
 */
export async function workflowState(copyRoot, releaseRoot) {
  const copyFile = join(copyRoot, WORKFLOW_PATH);
  const releaseFile = join(releaseRoot, WORKFLOW_PATH);
  if (!existsSync(copyFile) || !existsSync(releaseFile)) return { kind: 'not-compared' };
  const copy = workflowRevision(await readFile(copyFile, 'utf8'));
  const release = workflowRevision(await readFile(releaseFile, 'utf8'));
  return copy < release ? { kind: 'outdated', copy, release } : { kind: 'current' };
}

/**
 * Prints a GitHub Actions warning for an outdated workflow and adds the one-time manual step to the job summary.
 *
 * @param {WorkflowState} state
 * @param {string} version The release being installed.
 * @param {string} where Where that release's workflow file can be read.
 */
export async function reportWorkflow(state, version, where) {
  if (state.kind !== 'outdated') return;
  const step =
    `Copy ${WORKFLOW_PATH} from the Tether ${version} server/ folder (${where}) over the same file in this ` +
    'repository, once, by hand: GitHub does not let this workflow change its own file.';
  console.log(
    `::warning title=Tether workflow file outdated::This copy's ${WORKFLOW_PATH} is revision ${String(state.copy)}, ` +
      `Tether ${version} ships revision ${String(state.release)}. ${step}`,
  );
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) {
    await appendFile(summary, `### Update the workflow file once\n\n${step}\n`);
  }
}
