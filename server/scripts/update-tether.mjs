#!/usr/bin/env node
// @ts-nocheck
/**
 * Updates this deployed copy of tether-sync to the newest Tether release that matches
 * TETHER_VERSION (a file next to package.json), the way jsDelivr version ranges work:
 *
 *   0.3      newest 0.3.x (patches only)          <- default
 *   0.3.3    pinned: never changes
 *   latest   newest release, including new minor versions
 *
 * Replaces the code (src/, bin/, scripts/, test/, docs/, package.json, README) and keeps what is
 * yours: tether-sync.config.js (mapping), wrangler.jsonc (Cloudflare ids), TETHER_VERSION.
 * .github/ is never touched: GitHub doesn't let an Action's token change workflow files, so the
 * workflow stays as it is and all update logic lives in this script (which does update itself).
 * Run by .github/workflows/update-tether.yml (weekly + "Run workflow"), or by hand:
 *
 *   node scripts/update-tether.mjs            # check + update the working tree
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = process.env.TETHER_UPSTREAM || 'ravi-klaassens/tether';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromIdx = args.indexOf('--from');
const fromDir = fromIdx > -1 ? resolve(args[fromIdx + 1]) : null;

// What a release replaces. Everything else in the copy is left alone.
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
export const KEPT = ['tether-sync.config.js', 'wrangler.jsonc', 'TETHER_VERSION'];

export const parse = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Newest tag matching the spec ('latest', '0.3', '0.3.3'), or null. */
export function pickVersion(tags, spec) {
  const s = String(spec || '')
    .trim()
    .replace(/^v/, '')
    .toLowerCase();
  const versions = tags.map(parse).filter(Boolean).sort(cmp);
  if (!versions.length) return null;
  let ok;
  if (s === 'latest' || s === '*' || s === '') ok = () => true;
  else if (/^\d+$/.test(s)) ok = (v) => v[0] === +s;
  else if (/^\d+\.\d+$/.test(s)) {
    const [a, b] = s.split('.').map(Number);
    ok = (v) => v[0] === a && v[1] === b;
  } else if (parse(s)) {
    const p = parse(s);
    ok = (v) => cmp(v, p) === 0;
  } else throw new Error(`TETHER_VERSION must be latest, 0.3 or 0.3.3 (got "${spec}")`);
  const hit = versions.filter(ok).pop();
  return hit ? hit.join('.') : null;
}

async function githubJson(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'tether-sync-updater',
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
  return res.json();
}

async function fetchRelease(version) {
  const dir = await mkdtemp(join(tmpdir(), 'tether-release-'));
  const res = await fetch(`https://codeload.github.com/${UPSTREAM}/tar.gz/refs/tags/v${version}`);
  if (!res.ok) throw new Error(`download v${version}: ${res.status}`);
  const tgz = join(dir, 'release.tgz');
  await writeFile(tgz, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xzf', tgz, '-C', dir, '--strip-components=1']);
  const server = join(dir, 'server');
  if (!existsSync(join(server, 'package.json'))) throw new Error(`v${version} has no server/ folder`);
  return server;
}

async function main() {
  const specFile = join(ROOT, 'TETHER_VERSION');
  const spec = existsSync(specFile) ? (await readFile(specFile, 'utf8')).split('\n')[0].trim() : '';
  const current = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
  const effective = spec || current.split('.').slice(0, 2).join('.'); // no file: stay on this minor

  let target;
  let source;
  if (fromDir) {
    target = JSON.parse(await readFile(join(fromDir, 'package.json'), 'utf8')).version;
    source = fromDir;
  } else {
    const tags = (await githubJson(`/repos/${UPSTREAM}/tags?per_page=100`)).map((t) => t.name);
    target = pickVersion(tags, effective);
  }
  console.log(`current ${current}, TETHER_VERSION ${spec || `(none: ${effective})`}, newest match ${target || 'none'}`);
  if (!target) throw new Error(`no release matches "${effective}"`);
  if (cmp(parse(target), parse(current)) <= 0) {
    console.log('up to date');
    console.log('updated=');
    return;
  }
  if (dryRun) {
    console.log(`would update to ${target}`);
    console.log('updated=');
    return;
  }

  source = source || (await fetchRelease(target));
  for (const name of MANAGED) {
    const from = join(source, name);
    const to = join(ROOT, name);
    if (!existsSync(from)) continue;
    await rm(to, { recursive: true, force: true });
    await cp(from, to, { recursive: true });
  }
  for (const name of KEPT) {
    // A brand-new copy may not have these yet: take the release's version once.
    if (!existsSync(join(ROOT, name)) && existsSync(join(source, name)) && name !== 'TETHER_VERSION')
      await cp(join(source, name), join(ROOT, name));
  }
  if (!spec && !existsSync(specFile)) await writeFile(specFile, `${effective}\n`);
  await stat(join(ROOT, 'src', 'entry.js'));
  console.log(`updated to ${target}`);
  console.log(`updated=${target}`);
}

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
if (process.argv[1] && real(resolve(process.argv[1])) === real(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
