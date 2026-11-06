#!/usr/bin/env node
/**
 * Updates this deployed copy of tether-sync to the newest Tether release that matches TETHER_VERSION (a file next to
 * package.json), the way jsDelivr version ranges work:
 *
 *   0.6      newest 0.6.x (patches only)          <- shipped in TETHER_VERSION, and the default without the file
 *   0.6.0    pinned: never changes
 *   latest   newest release, including a new 0.x minor, which can break the copy
 *
 * It replaces the code (src/, bin/, scripts/, test/, docs/, package.json, README) and keeps what belongs to the copy:
 * tether-sync.config.js (mapping), wrangler.jsonc (Cloudflare ids), TETHER_VERSION. .github/ is never touched: GitHub
 * doesn't let an Action's token change workflow files, so all update logic lives in this script, which updates
 * itself, and a copy whose workflow is older than the release's is told how to replace it (scripts/workflow-check.mjs).
 *
 * Releases are the upstream repository's `v0.7.0` tags; a tag without the `v` is not a release. A release is
 * installed only when the commit its tag points at is part of the upstream default branch, and only from the signed
 * asset on its GitHub Release, after `gh attestation verify` confirms the upstream release workflow built it from that
 * commit (scripts/release-asset.mjs). It is staged inside the copy first and then swapped in by renames, so a failure
 * part-way leaves the copy as it was.
 *
 * The version rules live in `src/release-range.js`, which every copy has next to this script.
 *
 * Run by .github/workflows/update-tether.yml (weekly and "Run workflow"), or by hand:
 *
 *   node scripts/update-tether.mjs            # check and update the working tree
 *   node scripts/update-tether.mjs --dry-run  # only say what it would do
 *   node scripts/update-tether.mjs --allow-unverified   # without the GitHub CLI: install without the signature check
 *   node scripts/update-tether.mjs --from ../tether/server   # use a local release (testing)
 *
 * Prints `updated=<version>` (or `updated=` when nothing changed) and exits non-zero on any failure. Every copy keeps
 * the workflow it was made with, so this output is the contract between every shipped workflow and this script.
 */
import { readFile, writeFile, rm, cp, mkdir, mkdtemp, rename, stat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, newestInRange, parseVersion } from '../src/release-range.js';
import { field } from '../src/shared/json.js';
import { downloadAsset, fetchSignedRelease, runCommand } from './release-asset.mjs';
import { reportWorkflow, workflowState } from './workflow-check.mjs';
/** @import { GitHubGet, VerifyPolicy } from './release-asset.mjs' */

/** @typedef {{ name: string, sha: string }} Tag */

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
 * @param {string[]} tags Tag names.
 * @param {string} spec `latest`, `0`, `0.3` or `0.3.3`.
 * @returns {string | null} `0.3.3`, without the `v`.
 * @throws {Error} For a spec that is none of these.
 */
export function pickVersion(tags, spec) {
  const releases = tags.filter((tag) => tag.startsWith(TAG_PREFIX)).map((tag) => tag.slice(TAG_PREFIX.length));
  return newestInRange(releases, spec);
}

/** @type {GitHubGet} */
async function githubJson(path) {
  const token = process.env['GITHUB_TOKEN'];
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'tether-sync-updater',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub ${path}: ${response.status}`);
  return response.json();
}

/**
 * Every tag of the upstream repository with the commit it points at.
 *
 * @param {GitHubGet} get
 * @param {string} upstream `owner/repo`.
 * @returns {Promise<Tag[]>}
 */
export async function listTags(get, upstream) {
  /** @type {Tag[]} */
  const tags = [];
  for (let page = 1; page <= MAX_TAG_PAGES; page++) {
    const answer = await get(`/repos/${upstream}/tags?per_page=100&page=${page}`);
    if (!Array.isArray(answer) || !answer.length) break;
    /** @type {unknown[]} */
    const entries = answer;
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
 * @param {GitHubGet} get
 * @param {string} upstream
 * @param {Tag[]} tags
 * @param {string} version `0.3.3`.
 * @returns {Promise<string>} The commit SHA.
 * @throws {Error} When the tag is missing or points outside the default branch.
 */
export async function releaseCommit(get, upstream, tags, version) {
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

/** @param {string} path @returns {Promise<string>} */
async function packageVersion(path) {
  /** @type {unknown} */
  const json = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  const version = field(json, 'version');
  if (typeof version !== 'string') throw new Error(`${path}/package.json has no version`);
  return version;
}

/**
 * Moves each staged entry into the copy, the copy's own entry out of the way first. When a rename fails, the entries
 * already swapped are put back, so the copy is either all old or all new.
 *
 * @param {string[]} names
 * @param {string} staged The folder holding the release's entries.
 * @param {string} previous An empty folder for the copy's current entries.
 */
async function swapIn(names, staged, previous) {
  /** @type {string[]} */
  const moved = [];
  try {
    for (const name of names) {
      if (existsSync(join(ROOT, name))) await rename(join(ROOT, name), join(previous, name));
      moved.push(name);
      await rename(join(staged, name), join(ROOT, name));
    }
  } catch (error) {
    await putBack(moved.reverse(), previous, error);
    throw error;
  }
}

/** Putting the copy's own entries back failed: the copy is half updated, and its own entries are kept for a person. */
class RollbackError extends Error {}

/**
 * Restores the copy's own entries after a failed swap.
 *
 * @param {string[]} names The entries already swapped, last first.
 * @param {string} previous The folder holding the copy's own entries.
 * @param {unknown} swapError Named in the message: it is why the copy was being put back.
 * @throws {RollbackError}
 */
async function putBack(names, previous, swapError) {
  try {
    for (const name of names) {
      await rm(join(ROOT, name), { recursive: true, force: true });
      if (existsSync(join(previous, name))) await rename(join(previous, name), join(ROOT, name));
    }
  } catch (error) {
    const why = `the update failed (${messageOf(swapError)}) and putting the copy back failed (${messageOf(error)})`;
    throw new RollbackError(`${why}: the copy's own files are in ${previous}`, { cause: error });
  }
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Replaces the managed files with the release's, and adds the kept ones a new copy doesn't have yet. The release is
 * staged inside the copy, so the swap is a rename on one file system.
 *
 * @param {string} source The release's `server/` folder.
 */
async function install(source) {
  const work = await mkdtemp(join(ROOT, '.tether-update-'));
  let keepWork = false;
  try {
    const staged = join(work, 'new');
    const previous = join(work, 'old');
    await mkdir(staged);
    await mkdir(previous);
    const names = MANAGED.filter((name) => existsSync(join(source, name)));
    for (const name of names) await cp(join(source, name), join(staged, name), { recursive: true });
    await swapIn(names, staged, previous);
  } catch (error) {
    keepWork = error instanceof RollbackError;
    throw error;
  } finally {
    if (!keepWork) await rm(work, { recursive: true, force: true });
  }
  for (const name of KEPT) {
    const missing = !existsSync(join(ROOT, name)) && existsSync(join(source, name));
    if (missing && name !== 'TETHER_VERSION') await cp(join(source, name), join(ROOT, name));
  }
}

/**
 * The release to install from GitHub: the newest in the range, or `null` when none matches.
 *
 * @param {string} effective The range.
 * @returns {Promise<{ version: string, tags: Tag[] } | null>}
 */
async function newestRelease(effective) {
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
 * @param {string} source The release's `server/` folder.
 * @param {string} version
 * @param {string} where Where the release's workflow file can be read, for the warning.
 */
async function installRelease(source, version, where) {
  const found = await packageVersion(source);
  if (found !== version) throw new Error(`the release says it is ${version}, its package.json says ${found}`);
  await install(source);
  await reportWorkflow(await workflowState(ROOT, source), version, where);
}

/**
 * Downloads the release's signed asset, verifies it and installs it, removing the download afterwards.
 *
 * @param {string} version
 * @param {Tag[]} tags
 * @param {VerifyPolicy} policy
 */
async function installFromGitHub(version, tags, policy) {
  const sha = await releaseCommit(githubJson, UPSTREAM, tags, version);
  const dir = await mkdtemp(join(tmpdir(), 'tether-release-'));
  try {
    const source = { get: githubJson, run: runCommand, download: downloadAsset };
    const server = await fetchSignedRelease(source, { upstream: UPSTREAM, version, sha }, dir, policy);
    await installRelease(server, version, `https://github.com/${UPSTREAM}/tree/v${version}/server`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * @param {string[]} args
 * @returns {string | null} The local release folder after `--from`, or `null` without the option.
 * @throws {Error} For `--from` without a folder, which would otherwise install the copy over itself.
 */
function fromFolder(args) {
  const index = args.indexOf('--from');
  if (index === -1) return null;
  const folder = args[index + 1];
  if (folder === undefined || folder.startsWith('--')) throw new Error('--from needs the folder of a release');
  return resolve(folder);
}

/** @param {string[]} args */
async function main(args) {
  const dryRun = args.includes('--dry-run');
  /** @type {VerifyPolicy} */
  const policy = args.includes('--allow-unverified') ? 'allow-unverified' : 'require';
  const fromDir = fromFolder(args);

  const specFile = join(ROOT, 'TETHER_VERSION');
  const spec = existsSync(specFile) ? ((await readFile(specFile, 'utf8')).split('\n')[0] ?? '').trim() : '';
  const current = await packageVersion(ROOT);
  // Without a TETHER_VERSION file the copy stays on its own minor version.
  const effective = spec || current.split('.').slice(0, 2).join('.');
  /** @type {{ version: string, tags: Tag[] } | null} */
  let release;
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
    console.log('updated=');
    return;
  }
  if (dryRun) {
    console.log(`would update to ${release.version}`);
    console.log('updated=');
    return;
  }
  if (fromDir) await installRelease(fromDir, release.version, fromDir);
  else await installFromGitHub(release.version, release.tags, policy);
  if (!spec && !existsSync(specFile)) await writeFile(specFile, `${effective}\n`);
  await stat(join(ROOT, 'src', 'entry.js'));
  console.log(`updated to ${release.version}`);
  console.log(`updated=${release.version}`);
}

/** @param {string} path */
function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    // A path that doesn't resolve is compared as written.
    return path;
  }
}

const script = process.argv[1];
if (script && realPath(resolve(script)) === realPath(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((/** @type {unknown} */ error) => {
    console.error(messageOf(error));
    process.exit(1);
  });
}
