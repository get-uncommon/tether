/**
 * What `npm run release` reads from GitHub's answers about the commit it releases: whether a workflow's newest run for
 * a commit passed, and which commits' `release-rehearsal` runs stand for a change. Kept apart from release.ts's git,
 * gh and npm calls, so the tests can hand it GitHub's answers.
 */
import { parse } from 'yaml';
import { asList, field } from '../server/src/shared/json.ts';

/** The state of a commit's newest run of one workflow. */
export type RunState =
  { kind: 'passed' } | { kind: 'missing' } | { kind: 'running'; url: string } | { kind: 'failed'; url: string };

/** @param listed The output of `gh run list --json=status,conclusion,url`, which lists the newest run first. */
export function newestRun(listed: string): RunState {
  const newest = asList(JSON.parse(listed))[0];
  if (newest === undefined) return { kind: 'missing' };
  const url = String(field(newest, 'url'));
  if (field(newest, 'status') !== 'completed') return { kind: 'running', url };
  return field(newest, 'conclusion') === 'success' ? { kind: 'passed' } : { kind: 'failed', url };
}

/**
 * @param workflow The text of `.github/workflows/release-rehearsal.yml`.
 * @returns Its `pull_request` paths, as git pathspecs: a commit that changes none of them changes nothing the rehearsal
 *   tests.
 */
export function rehearsalPathspecs(workflow: string): string[] {
  const paths = asList(field(field(field(parse(workflow), 'on'), 'pull_request'), 'paths'));
  return paths.map((path) => `:(glob)${String(path)}`);
}

/**
 * @param sha A commit on `branch`.
 * @param pulls The output of `gh api repos/{owner}/{repo}/commits/<sha>/pulls`.
 * @returns `sha`, then the head commit of each pull request merged into `branch` with it: a passed rehearsal run for
 *   any of them ran the gate at the next versions on the change `sha` made.
 */
export function rehearsalCommits(sha: string, branch: string, pulls: string): string[] {
  const heads = asList(JSON.parse(pulls))
    .filter((pull) => typeof field(pull, 'merged_at') === 'string' && field(field(pull, 'base'), 'ref') === branch)
    .map((pull) => String(field(field(pull, 'head'), 'sha')));
  return [...new Set([sha, ...heads])];
}
