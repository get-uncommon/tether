/**
 * CI's `dist` job (`.github/workflows/ci.yml`, through `dist-guard.ts`): no commit of a pull request but a release
 * commit changes dist/, which is what the last release built. A release commit is known by its content as well as its
 * subject: it is `Tether X.Y.Z`, it moves package.json to X.Y.Z, and it changes nothing but the release's files
 * (`isReleaseCommitFile`). A merge is checked by what it changes against its first parent, unless its dist/ is one of
 * its other parents' as it is, which a merge of the base branch brings in.
 */
import { spawnSync } from 'node:child_process';
import { field } from '../server/src/shared/json.ts';
import { isReleaseCommitFile } from './release-version.ts';

const RELEASE_SUBJECT = /^Tether (\d+\.\d+\.\d+)$/;

interface Commit {
  sha: string;
  /** The first is the one a merge is diffed against. */
  parents: string[];
  subject: string;
}

/** What `distProblems` asks git about the commits from `base` to `head`. */
export interface DistHistory {
  /** The commits in `base..head`, merges included; `null` when git can't list them. */
  commits(base: string, head: string): Commit[] | null;
  /** The files whose content differs between the trees of `from` and `to`; `null` when git can't tell. */
  changedFiles(from: string, to: string): string[] | null;
  /** The version in package.json at `sha`; `null` without one. */
  packageVersion(sha: string): string | null;
  /** The id of dist/'s tree at `sha`; `null` when it has none. */
  distTree(sha: string): string | null;
}

/** @returns Why `commit`, which changes dist/ and `files` against its first parent, is not a release commit. */
function notReleaseReason(commit: Commit, parent: string, files: readonly string[], history: DistHistory) {
  const subjectVersion = RELEASE_SUBJECT.exec(commit.subject)?.[1];
  if (subjectVersion === undefined) return 'its subject is not "Tether X.Y.Z"';
  const version = history.packageVersion(commit.sha);
  if (version !== subjectVersion || history.packageVersion(parent) === version) {
    return `it doesn't move package.json to ${subjectVersion}`;
  }
  const other = files.find((file) => !isReleaseCommitFile(file));
  return other === undefined ? null : `it also changes ${other}`;
}

/**
 * @returns One line for each commit in `base..head` that changes dist/ and is not a release commit, naming it and
 *   why; one line, with no commit, when git can't list them.
 */
export function distProblems(base: string, head: string, history: DistHistory): string[] {
  const commits = history.commits(base, head);
  if (commits === null) return [`the commits of ${base}..${head} can't be listed`];
  const problems: string[] = [];
  for (const commit of commits) {
    const [parent, ...mergedParents] = commit.parents;
    // A pull request's commits all have a parent: its base is one.
    if (parent === undefined) continue;
    const files = history.changedFiles(parent, commit.sha);
    if (files === null) {
      problems.push(`${commit.sha.slice(0, 12)} ${commit.subject}: the files it changes can't be listed`);
      continue;
    }
    if (!files.some((file) => file.startsWith('dist/'))) continue;
    const dist = history.distTree(commit.sha);
    if (mergedParents.some((merged) => history.distTree(merged) === dist)) continue;
    const reason = notReleaseReason(commit, parent, files, history);
    if (reason !== null) problems.push(`${commit.sha.slice(0, 12)} ${commit.subject}: ${reason}`);
  }
  return problems;
}

/** The repository at `root`, as git answers for it. */
export function gitDistHistory(root: string): DistHistory {
  const git = (args: readonly string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const answer = (args: readonly string[]) => {
    const result = git(args);
    return result.status === 0 ? result.stdout : null;
  };
  return {
    commits(base, head) {
      const log = answer(['log', '--format=%H%x09%P%x09%s', `${base}..${head}`]);
      if (log === null) return null;
      return log
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [sha = '', parents = '', ...subject] = line.split('\t');
          return { sha, parents: parents.split(' ').filter(Boolean), subject: subject.join('\t') };
        });
    },
    // Rename detection would list a file moved into dist/ by its new path alone.
    changedFiles: (from, to) =>
      answer(['diff', '--name-only', '--no-renames', from, to])?.split('\n').filter(Boolean) ?? null,
    packageVersion(sha) {
      const json = answer(['show', `${sha}:package.json`]);
      if (json === null) return null;
      const version = field(JSON.parse(json), 'version');
      return typeof version === 'string' ? version : null;
    },
    distTree: (sha) => answer(['rev-parse', '--verify', '--quiet', `${sha}:dist`])?.trim() ?? null,
  };
}
