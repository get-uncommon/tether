/**
 * Tells the owner of a copy when its update workflow is older than the release it runs or installs. GitHub doesn't
 * let a workflow's token change workflow files, so an update never replaces `.github/workflows/update-tether.yml`: a
 * copy keeps the workflow it was made with until a person copies the new one in.
 *
 * Copies may edit their workflow (the README suggests a daily `cron`), so the files are not compared byte for byte.
 * The shipped workflow carries a `# Tether workflow revision: N` line instead, raised whenever a copy needs the new
 * file; a workflow without that line is revision 1, the one every copy made before 0.7.0 has. The check runs on every
 * update run, also when nothing is installed, so a copy brought to a release by an older updater is told too.
 */
import { readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type WorkflowState =
  { kind: 'current' } | { kind: 'outdated'; copy: number; release: number } | { kind: 'not-compared' };

/** Where the workflow lives, in the copy and in a release's `server/` folder alike. */
export const WORKFLOW_PATH = '.github/workflows/update-tether.yml';

/**
 * The revision of the workflow this release ships: what a copy already on this release is compared with, since the
 * copy holds no other version of the file. A test holds it to the shipped file's own line.
 */
export const SHIPPED_REVISION = 3;

const REVISION_LINE = /^# Tether workflow revision: (\d+)\s*$/m;
const FIRST_REVISION = 1;

/** @param workflow The workflow file's text. */
export function workflowRevision(workflow: string): number {
  const revision = REVISION_LINE.exec(workflow)?.[1];
  return revision === undefined ? FIRST_REVISION : Number(revision);
}

/**
 * @param root A copy, or a release's `server/` folder.
 * @returns `null` when it has no workflow (a copy run by hand, without Actions).
 */
export async function workflowRevisionAt(root: string): Promise<number | null> {
  const file = join(root, WORKFLOW_PATH);
  return existsSync(file) ? workflowRevision(await readFile(file, 'utf8')) : null;
}

/**
 * @param release The revision the copy should have: the release's file when installing one, else
 *   {@link SHIPPED_REVISION}.
 * @returns `not-compared` when the copy or the release has no workflow.
 */
export async function workflowState(copyRoot: string, release: number | null): Promise<WorkflowState> {
  const copy = await workflowRevisionAt(copyRoot);
  if (copy === null || release === null) return { kind: 'not-compared' };
  return copy < release ? { kind: 'outdated', copy, release } : { kind: 'current' };
}

/**
 * Prints a GitHub Actions warning for an outdated workflow and adds the one-time manual step to the job summary.
 *
 * @param version The release whose workflow the copy needs.
 * @param where Where that release's workflow file can be read.
 */
export async function reportWorkflow(state: WorkflowState, version: string, where: string): Promise<void> {
  if (state.kind !== 'outdated') return;
  const step =
    `Copy the Tether ${version} workflow file (${where}) over ${WORKFLOW_PATH} in this repository and commit it, ` +
    'once, by hand, keeping your own `cron` line if you changed it: GitHub does not let this workflow change its ' +
    'own file.';
  console.log(
    `::warning title=Tether workflow file outdated::This copy's ${WORKFLOW_PATH} is revision ${String(state.copy)}, ` +
      `Tether ${version} ships revision ${String(state.release)}. ${step}`,
  );
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) {
    await appendFile(summary, `### Update the workflow file once\n\n${step}\n`);
  }
}
