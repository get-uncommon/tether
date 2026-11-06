#!/usr/bin/env node
/**
 * Updates this deployed copy of tether-sync to the newest Tether release that matches TETHER_VERSION (a file next to
 * package.json), the way jsDelivr version ranges work:
 *
 *   0.3      newest 0.3.x (patches only)          <- default
 *   0.3.3    pinned: never changes
 *   latest   newest release, including new minor versions
 *
 * It replaces the code (src/, bin/, scripts/, test/, docs/, package.json, README) and keeps what belongs to the copy:
 * tether-sync.config.js (mapping), wrangler.jsonc (Cloudflare ids), TETHER_VERSION. .github/ is never touched: GitHub
 * doesn't let an Action's token change workflow files, so the workflow stays as it is and all update logic lives in
 * this script, which updates itself.
 *
 * A release is downloaded by the commit its tag points at, and only when that commit is part of the upstream
 * repository's default branch: a tag moved to a commit outside it is refused.
 *
 * Run by .github/workflows/update-tether.yml (weekly and "Run workflow"), or by hand:
 *
 *   node scripts/update-tether.mjs            # check and update the working tree
 *   node scripts/update-tether.mjs --dry-run  # only say what it would do
 *   node scripts/update-tether.mjs --from ../tether/server   # use a local release (testing)
 *
 * Prints `updated=<version>` (or `updated=`) for the workflow.
 */
import { readFile, writeFile, rm, cp, mkdtemp, stat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {[number, number, number]} Version */
/** @typedef {{ name: string, sha: string }} Tag */
/** @typedef {(path: string) => Promise<unknown>} GitHubGet */

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

/**
 * @param {string} text `0.3.3` or `v0.3.3`.
 * @returns {Version | null}
 */
export function parse(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** @param {Version} a @param {Version} b */
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * @param {string} spec `latest`, `0`, `0.3` or `0.3.3`.
 * @returns {(version: Version) => boolean}
 */
function matcher(spec) {
  const range = spec.trim().replace(/^v/, '').toLowerCase();
  if (range === 'latest' || range === '*' || range === '') return () => true;
  if (/^\d+$/.test(range)) return (version) => version[0] === Number(range);
  if (/^\d+\.\d+$/.test(range)) {
    const [major, minor] = range.split('.').map(Number);
    return (version) => version[0] === major && version[1] === minor;
  }
  const exact = parse(range);
  if (exact) return (version) => compare(version, exact) === 0;
  throw new Error(`TETHER_VERSION must be latest, 0.3 or 0.3.3 (got "${spec}")`);
}

/**
 * The newest tag matching the spec.
 *
 * @param {string[]} tags
 * @param {string} spec `latest`, `0.3` or `0.3.3`.
 * @returns {string | null} `0.3.3`, without the `v`.
 */
export function pickVersion(tags, spec) {
  const matches = matcher(spec);
  const versions = tags
    .map(parse)
    .filter((version) => version !== null)
    .filter(matches)
    .sort(compare);
  return versions.at(-1)?.join('.') ?? null;
}

/** @param {unknown} value @param {string} key */
function field(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  return /** @type {Record<string, unknown>} */ (value)[key];
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
    for (const entry of /** @type {unknown[]} */ (answer)) {
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
  const tag = tags.find((candidate) => candidate.name === `v${version}`);
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

/**
 * Downloads and unpacks the release's `server/` folder.
 *
 * @param {string} upstream
 * @param {string} sha
 * @returns {Promise<string>} The unpacked `server/` folder.
 */
async function fetchRelease(upstream, sha) {
  const dir = await mkdtemp(join(tmpdir(), 'tether-release-'));
  const response = await fetch(`https://codeload.github.com/${upstream}/tar.gz/${sha}`);
  if (!response.ok) throw new Error(`download ${sha}: ${response.status}`);
  const archive = join(dir, 'release.tgz');
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync('tar', ['-xzf', archive, '-C', dir, '--strip-components=1']);
  const server = join(dir, 'server');
  if (!existsSync(join(server, 'package.json'))) throw new Error(`${sha} has no server/ folder`);
  return server;
}

/** @param {string} path @returns {Promise<string>} */
async function packageVersion(path) {
  const version = field(JSON.parse(await readFile(join(path, 'package.json'), 'utf8')), 'version');
  if (typeof version !== 'string') throw new Error(`${path}/package.json has no version`);
  return version;
}

/**
 * Replaces the managed files with the release's, and adds the kept ones a new copy doesn't have yet.
 *
 * @param {string} source The release's `server/` folder.
 */
async function install(source) {
  for (const name of MANAGED) {
    const from = join(source, name);
    if (!existsSync(from)) continue;
    const to = join(ROOT, name);
    await rm(to, { recursive: true, force: true });
    await cp(from, to, { recursive: true });
  }
  for (const name of KEPT) {
    const missing = !existsSync(join(ROOT, name)) && existsSync(join(source, name));
    if (missing && name !== 'TETHER_VERSION') await cp(join(source, name), join(ROOT, name));
  }
}

/** @param {string[]} args */
async function main(args) {
  const dryRun = args.includes('--dry-run');
  const fromIndex = args.indexOf('--from');
  const fromDir = fromIndex === -1 ? null : resolve(args[fromIndex + 1] ?? '.');

  const specFile = join(ROOT, 'TETHER_VERSION');
  const spec = existsSync(specFile) ? ((await readFile(specFile, 'utf8')).split('\n')[0] ?? '').trim() : '';
  const current = await packageVersion(ROOT);
  // Without a TETHER_VERSION file the copy stays on its own minor version.
  const effective = spec || current.split('.').slice(0, 2).join('.');
  const tags = fromDir ? [] : await listTags(githubJson, UPSTREAM);
  const target = fromDir
    ? await packageVersion(fromDir)
    : pickVersion(
        tags.map((tag) => tag.name),
        effective,
      );
  console.log(`current ${current}, TETHER_VERSION ${spec || `(none: ${effective})`}, newest match ${target ?? 'none'}`);
  if (!target) throw new Error(`no release matches "${effective}"`);
  const targetVersion = parse(target);
  const currentVersion = parse(current);
  if (targetVersion && currentVersion && compare(targetVersion, currentVersion) <= 0) {
    console.log('up to date');
    console.log('updated=');
    return;
  }
  if (dryRun) {
    console.log(`would update to ${target}`);
    console.log('updated=');
    return;
  }
  const source = fromDir ?? (await fetchRelease(UPSTREAM, await releaseCommit(githubJson, UPSTREAM, tags, target)));
  await install(source);
  if (!spec && !existsSync(specFile)) await writeFile(specFile, `${effective}\n`);
  await stat(join(ROOT, 'src', 'entry.js'));
  console.log(`updated to ${target}`);
  console.log(`updated=${target}`);
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
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
