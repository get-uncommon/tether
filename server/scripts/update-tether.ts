#!/usr/bin/env node
/**
 * Updates this deployed copy of tether-sync to the newest Tether release that matches TETHER_VERSION (a file next to
 * package.json), the way jsDelivr version ranges work:
 *
 *   X.Y      newest X.Y.z (patches only)   <- a release ships its own minor version in TETHER_VERSION; without
 *                                             the file, the copy's own minor version
 *   X.Y.Z    pinned: never changes
 *   latest   newest release, including a new 0.x minor, which can break the copy
 *
 * It replaces the code (src/, bin/, scripts/, test/, docs/, package.json, README) and keeps what belongs to the copy:
 * tether-sync.config.js (mapping), wrangler.jsonc (Cloudflare ids), TETHER_VERSION. .github/ is never touched: GitHub
 * doesn't let an Action's token change workflow files, so all update logic lives in this script, which updates
 * itself, and a copy whose workflow is older than the release's is told how to replace it (scripts/workflow-check.ts).
 *
 * Releases are the upstream repository's `vX.Y.Z` tags; a tag without the `v` is not a release. A release is
 * installed only when the commit its tag points at is part of the upstream default branch, and only from the signed
 * asset on its GitHub Release, after `gh attestation verify` confirms the upstream release workflow built it from that
 * commit (scripts/release-asset.ts). It is staged inside the copy first and then swapped in by renames, so a failure
 * part-way leaves the copy as it was.
 *
 * The version rules live in `src/release-range.ts`, which every copy has next to this script.
 *
 * Run by .github/workflows/update-tether.yml (weekly and "Run workflow"), or by hand:
 *
 *   node scripts/update-tether.mjs            # check and update the working tree
 *   node scripts/update-tether.mjs --dry-run  # only say what it would do
 *   node scripts/update-tether.mjs --allow-unverified   # without the GitHub CLI: install without the signature check
 *   node scripts/update-tether.mjs --from ../tether/server   # use a local release (testing)
 *
 * Prints `updated=<version>` (or `updated=` when nothing changed). On any failure it prints an `::error` annotation
 * instead and exits non-zero. Every copy keeps the workflow it was made with, so this output is the contract between
 * every shipped workflow and this script.
 */
import { readFile, writeFile, rm, cp, mkdir, mkdtemp, rename, stat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, newestInRange, parseVersion } from '../src/release-range.ts';
import { field } from '../src/shared/json.ts';
import { messageOf } from '../src/shared/error-message.ts';
import { downloadAsset, fetchSignedRelease, runCommand } from './release-asset.ts';
import {
  reportWorkflow,
  SHIPPED_REVISION,
  WORKFLOW_PATH,
  workflowRevisionAt,
  workflowState,
} from './workflow-check.ts';
import type { GitHubGet, VerifyPolicy } from './release-asset.ts';

interface Tag {
  name: string;
  sha: string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The repository releases come from. TETHER_UPSTREAM points a test copy at a fork. */
const UPSTREAM = process.env['TETHER_UPSTREAM'] ?? 'ravi-klaassens/tether';
/** Pages of 100 tags read at most. */
const MAX_TAG_PAGES = 20;

/** What a release replaces. Everything else in the copy is left alone. */
export const MANAGED = [
  'src',
  'bin',
  'scripts',
  'test',
  'docs',
  'package.json',
  'README.md',
  '.dev.vars.example',
  '.gitignore',
];
/** What a release never replaces, though a brand-new copy takes the release's version once. */
export const KEPT = ['tether-sync.config.js', 'wrangler.jsonc', 'TETHER_VERSION'];

/** The prefix of a release tag: `v0.3.3` installs version `0.3.3`. */
const TAG_PREFIX = 'v';

/**
 * The newest release tag in the range. Only `v` tags count, because {@link releaseCommit} installs `v<version>`.
 *
 * @param tags Tag names.
 * @param spec `latest`, `0`, `0.3` or `0.3.3`.
 * @returns `0.3.3`, without the `v`.
 * @throws For a spec that is none of these.
 */
export function pickVersion(tags: string[], spec: string): string | null {
  const releases = tags.filter((tag) => tag.startsWith(TAG_PREFIX)).map((tag) => tag.slice(TAG_PREFIX.length));
  return newestInRange(releases, spec);
}

async function githubJson(path: string): Promise<unknown> {
  const token = process.env['GITHUB_TOKEN'];
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'tether-sync-updater',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub ${path}: ${String(response.status)}`);
  const answer: unknown = await response.json();
  return answer;
}

/**
 * Every tag of the upstream repository with the commit it points at.
 *
 * @param upstream `owner/repo`.
 */
export async function listTags(get: GitHubGet, upstream: string): Promise<Tag[]> {
  const tags: Tag[] = [];
  for (let page = 1; page <= MAX_TAG_PAGES; page++) {
    const answer = await get(`/repos/${upstream}/tags?per_page=100&page=${page}`);
    if (!Array.isArray(answer) || !answer.length) break;
    const entries: unknown[] = answer;
    for (const entry of entries) {
      const name = field(entry, 'name');
      const sha = field(field(entry, 'commit'), 'sha');
      if (typeof name === 'string' && typeof sha === 'string') tags.push({ name, sha });
    }
  }
  return tags;
}

/**
 * The commit to install for `version`, after checking that it is part of the upstream default branch's history.
 *
 * @param version `0.3.3`.
 * @returns The commit SHA.
 * @throws When the tag is missing or points outside the default branch.
 */
export async function releaseCommit(get: GitHubGet, upstream: string, tags: Tag[], version: string): Promise<string> {
  const tag = tags.find((candidate) => candidate.name === `${TAG_PREFIX}${version}`);
  if (!tag || !/^[0-9a-f]{40}$/.test(tag.sha)) throw new Error(`v${version}: no tag with a commit`);
  const branch = field(await get(`/repos/${upstream}`), 'default_branch');
  if (typeof branch !== 'string' || !branch) throw new Error(`${upstream}: no default branch`);
  // "ahead" or "identical": the branch contains the commit. "behind" or "diverged": the tag points elsewhere.
  const status = field(await get(`/repos/${upstream}/compare/${tag.sha}...${encodeURIComponent(branch)}`), 'status');
  if (status !== 'ahead' && status !== 'identical') {
    throw new Error(
      `v${version} (${tag.sha}) is not on ${upstream}'s ${branch} branch (${String(status)}): not installed`,
    );
  }
  return tag.sha;
}

async function packageVersion(path: string): Promise<string> {
  const json: unknown = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  const version = field(json, 'version');
  if (typeof version !== 'string') throw new Error(`${path}/package.json has no version`);
  return version;
}

/** The copy {@link install} writes to, and the rename it swaps entries with. */
export interface InstallTarget {
  root: string;
  rename: (from: string, to: string) => Promise<void>;
}

/** This deployed copy. */
const OWN_COPY: InstallTarget = { root: ROOT, rename };

/**
 * Moves each staged entry into the copy, the copy's own entry out of the way first. When a rename fails, the entries
 * already swapped are put back, so the copy is either all old or all new.
 *
 * @param staged The folder holding the release's entries.
 * @param previous An empty folder for the copy's current entries.
 */
async function swapIn(target: InstallTarget, names: string[], staged: string, previous: string): Promise<void> {
  const { root } = target;
  const moved: string[] = [];
  try {
    for (const name of names) {
      if (existsSync(join(root, name))) await target.rename(join(root, name), join(previous, name));
      moved.push(name);
      await target.rename(join(staged, name), join(root, name));
    }
  } catch (error) {
    await putBack(target, moved.reverse(), previous, error);
    throw error;
  }
}

/** Putting the copy's own entries back failed: the copy is half updated, and its own entries are kept for a person. */
export class RollbackError extends Error {}

/**
 * Restores the copy's own entries after a failed swap.
 *
 * @param names The entries already swapped, last first.
 * @param previous The folder holding the copy's own entries.
 * @param swapError Named in the message: it is why the copy was being put back.
 * @throws A {@link RollbackError}.
 */
async function putBack(target: InstallTarget, names: string[], previous: string, swapError: unknown): Promise<void> {
  const { root } = target;
  try {
    for (const name of names) {
      await rm(join(root, name), { recursive: true, force: true });
      if (existsSync(join(previous, name))) await target.rename(join(previous, name), join(root, name));
    }
  } catch (error) {
    const why = `the update failed (${messageOf(swapError)}) and putting the copy back failed (${messageOf(error)})`;
    throw new RollbackError(`${why}: the copy's own files are in ${previous}`, { cause: error });
  }
}

/**
 * Replaces the managed files with the release's, and adds the kept ones a new copy doesn't have yet. The release is
 * staged inside the copy, so the swap is a rename on one file system.
 *
 * @param source The release's `server/` folder.
 * @throws The swap's error after putting the copy back, or a {@link RollbackError} when that failed too; the work
 *   folder (`.tether-update-*`) is kept only then.
 */
export async function install(source: string, target: InstallTarget = OWN_COPY): Promise<void> {
  const { root } = target;
  const work = await mkdtemp(join(root, '.tether-update-'));
  let keepWork = false;
  try {
    const staged = join(work, 'new');
    const previous = join(work, 'old');
    await mkdir(staged);
    await mkdir(previous);
    const names = MANAGED.filter((name) => existsSync(join(source, name)));
    for (const name of names) await cp(join(source, name), join(staged, name), { recursive: true });
    await swapIn(target, names, staged, previous);
  } catch (error) {
    keepWork = error instanceof RollbackError;
    throw error;
  } finally {
    if (!keepWork) await rm(work, { recursive: true, force: true });
  }
  for (const name of KEPT) {
    const missing = !existsSync(join(root, name)) && existsSync(join(source, name));
    if (missing && name !== 'TETHER_VERSION') await cp(join(source, name), join(root, name));
  }
}

/**
 * The release to install from GitHub: the newest in the range, or `null` when none matches.
 *
 * @param effective The range.
 */
async function newestRelease(effective: string): Promise<{ version: string; tags: Tag[] } | null> {
  const tags = await listTags(githubJson, UPSTREAM);
  const version = pickVersion(
    tags.map((tag) => tag.name),
    effective,
  );
  return version ? { version, tags } : null;
}

/**
 * Installs a release's `server/` folder, then warns when the copy's workflow is older than the release's.
 *
 * @param source The release's `server/` folder.
 * @param where Where the release's workflow file can be read, for the warning.
 */
async function installRelease(source: string, version: string, where: string): Promise<void> {
  const found = await packageVersion(source);
  if (found !== version) throw new Error(`the release says it is ${version}, its package.json says ${found}`);
  await install(source);
  await reportWorkflow(await workflowState(ROOT, await workflowRevisionAt(source)), version, where);
}

/**
 * Downloads the release's signed asset, verifies it and installs it, removing the download afterwards.
 */
async function installFromGitHub(version: string, tags: Tag[], policy: VerifyPolicy): Promise<void> {
  const sha = await releaseCommit(githubJson, UPSTREAM, tags, version);
  const dir = await mkdtemp(join(tmpdir(), 'tether-release-'));
  try {
    const source = { get: githubJson, run: runCommand, download: downloadAsset };
    const server = await fetchSignedRelease(source, { upstream: UPSTREAM, version, sha }, dir, policy);
    await installRelease(server, version, releaseWorkflowUrl(version));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Where the workflow file of an upstream release can be read on GitHub. */
function releaseWorkflowUrl(version: string): string {
  return `https://github.com/${UPSTREAM}/blob/v${version}/server/${WORKFLOW_PATH}`;
}

/**
 * @returns The local release folder after `--from`, or `null` without the option.
 * @throws For `--from` without a folder, which would otherwise install the copy over itself.
 */
function fromFolder(args: string[]): string | null {
  const index = args.indexOf('--from');
  if (index === -1) return null;
  const folder = args[index + 1];
  if (folder === undefined || folder.startsWith('--')) throw new Error('--from needs the folder of a release');
  return resolve(folder);
}

/**
 * Warns when the copy's workflow is older than the one its own release ships.
 *
 * @param args The script's arguments: with `--from`, the release's workflow is read from that folder.
 */
async function reportOwnWorkflow(args: string[]): Promise<void> {
  const current = await packageVersion(ROOT);
  const fromDir = fromFolder(args);
  const where = fromDir ? join(fromDir, WORKFLOW_PATH) : releaseWorkflowUrl(current);
  await reportWorkflow(await workflowState(ROOT, SHIPPED_REVISION), current, where);
}

/** `text` as the message of a GitHub Actions workflow command, which ends at the first line break. */
function workflowCommandText(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

/**
 * Says why the update failed, in a way every shipped workflow shows. Revision 1 of the workflow pipes this script's
 * output through `tee` in a shell without `pipefail`, so its step passes whatever this script exits with and only
 * skips installing: the `::error` annotation, which GitHub reads from stdout, is what shows the failure there, and the
 * outdated-workflow warning says how to get a workflow whose run fails instead.
 */
async function reportFailure(error: unknown, args: string[]): Promise<void> {
  const message = messageOf(error);
  console.error(message);
  console.log(`::error title=Tether update failed::${workflowCommandText(message)}`);
  await reportOwnWorkflow(args);
}

async function main(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const policy: VerifyPolicy = args.includes('--allow-unverified') ? 'allow-unverified' : 'require';
  const fromDir = fromFolder(args);

  const specFile = join(ROOT, 'TETHER_VERSION');
  const spec = existsSync(specFile) ? ((await readFile(specFile, 'utf8')).split('\n')[0] ?? '').trim() : '';
  const current = await packageVersion(ROOT);
  // Without a TETHER_VERSION file the copy stays on its own minor version.
  const effective = spec || current.split('.').slice(0, 2).join('.');
  let release: { version: string; tags: Tag[] } | null;
  if (fromDir) {
    // A local release is installed whatever the range says: it is how a release is tried before it is tagged.
    release = { version: await packageVersion(fromDir), tags: [] };
    console.log(`current ${current}, local release ${release.version} (${fromDir})`);
  } else {
    release = await newestRelease(effective);
    const range = spec || `(none: ${effective})`;
    console.log(`current ${current}, TETHER_VERSION ${range}, newest match ${release?.version ?? 'none'}`);
  }
  if (!release) throw new Error(`no release matches "${effective}"`);
  const targetVersion = parseVersion(release.version);
  const currentVersion = parseVersion(current);
  if (targetVersion && currentVersion && compareVersions(targetVersion, currentVersion) <= 0) {
    console.log('up to date');
    await reportOwnWorkflow(args);
    console.log('updated=');
    return;
  }
  if (dryRun) {
    console.log(`would update to ${release.version}`);
    console.log('updated=');
    return;
  }
  if (fromDir) await installRelease(fromDir, release.version, join(fromDir, WORKFLOW_PATH));
  else await installFromGitHub(release.version, release.tags, policy);
  if (!spec && !existsSync(specFile)) await writeFile(specFile, `${effective}\n`);
  await stat(join(ROOT, 'src', 'entry.js'));
  console.log(`updated to ${release.version}`);
  console.log(`updated=${release.version}`);
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // A path that doesn't resolve is compared as written.
    return path;
  }
}

const script = process.argv[1];
const self = fileURLToPath(import.meta.url);
// Run directly, or through the `update-tether.mjs` shim that the workflow of every deployed copy names.
const entryPoints = [self, self.replace(/\.ts$/, '.mjs')].map(realPath);
if (script && entryPoints.includes(realPath(resolve(script)))) {
  const args = process.argv.slice(2);
  main(args).catch(async (error: unknown) => {
    try {
      await reportFailure(error, args);
    } finally {
      process.exit(1);
    }
  });
}
