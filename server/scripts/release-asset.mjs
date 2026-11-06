/**
 * The signed form of a release: `tether-server-<version>.tar.gz`, which the upstream repository's release workflow
 * (`.github/workflows/release.yml`) builds from the tag's `server/` folder, attests with a GitHub artifact attestation
 * and uploads to the GitHub Release. The updater installs a release only from this file, and only after
 * `gh attestation verify` confirms that this workflow built it from the tag's commit. A download that was swapped on
 * the way, or a file uploaded to the Release by hand, has no such attestation and is refused.
 */
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { asList, field } from '../src/shared/json.js';

/** @typedef {(path: string) => Promise<unknown>} GitHubGet */
/**
 * How a command ended. `missing`: the program isn't installed, which a person running the updater by hand can fix.
 *
 * @typedef {{ kind: 'exited', status: number, output: string } | { kind: 'missing' }} CommandResult
 */
/** @typedef {(command: string, args: string[]) => CommandResult} RunCommand */
/**
 * What to do without `gh`: `require` refuses to install, `allow-unverified` installs with a warning. Either way a
 * verification that `gh` ran and that failed is refused: it means the file is not what the release workflow built.
 *
 * @typedef {'require' | 'allow-unverified'} VerifyPolicy
 */
/** @typedef {{ kind: 'verified' } | { kind: 'unverified' }} Verification */
/** @typedef {{ upstream: string, version: string, sha: string }} Release */
/**
 * Where a release comes from: the GitHub API, a command runner for `gh`, and the download. Tests pass fakes.
 *
 * @typedef {{ get: GitHubGet, run: RunCommand, download: (url: string, dir: string) => Promise<string> }} ReleaseSource
 */

/** The first release whose GitHub Release carries the attested asset. */
export const FIRST_SIGNED_RELEASE = '0.7.0';

/** @param {string} version `0.7.0`. */
export function releaseAssetName(version) {
  return `tether-server-${version}.tar.gz`;
}

/** @type {RunCommand} */
export function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    if ('code' in result.error && result.error.code === 'ENOENT') return { kind: 'missing' };
    throw result.error;
  }
  return { kind: 'exited', status: result.status ?? 1, output: `${result.stdout}${result.stderr}`.trim() };
}

/** @param {Release} release @param {string} why */
function unsignedRelease(release, why) {
  return new Error(
    `v${release.version} has no signed ${releaseAssetName(release.version)} on its GitHub Release (${why}). ` +
      `Releases before ${FIRST_SIGNED_RELEASE} have none, so this updater can't install them: ` +
      `set TETHER_VERSION to ${FIRST_SIGNED_RELEASE} or newer.`,
  );
}

/**
 * The download URL of the release's signed asset.
 *
 * @param {GitHubGet} get
 * @param {Release} release
 * @returns {Promise<string>}
 * @throws {Error} When the GitHub Release or its asset is missing, naming the releases that never had one.
 */
export async function releaseAssetUrl(get, release) {
  const name = releaseAssetName(release.version);
  /** @type {unknown} */
  let answer;
  try {
    answer = await get(`/repos/${release.upstream}/releases/tags/v${release.version}`);
  } catch (error) {
    throw unsignedRelease(release, error instanceof Error ? error.message : String(error));
  }
  const asset = asList(field(answer, 'assets')).find((entry) => field(entry, 'name') === name);
  const url = field(asset, 'browser_download_url');
  if (typeof url !== 'string') throw unsignedRelease(release, `no asset named ${name}`);
  return url;
}

/**
 * Checks that `file` was built by the upstream release workflow, from the tag's commit.
 *
 * @param {RunCommand} run
 * @param {string} file The downloaded asset.
 * @param {Release} release `sha` is the tag's commit, already checked to be on the default branch.
 * @param {VerifyPolicy} policy
 * @returns {Verification}
 * @throws {Error} When the attestation doesn't verify, or `gh` is missing and the policy requires it.
 */
export function verifyAttestation(run, file, release, policy) {
  const { upstream, version, sha } = release;
  const result = run('gh', [
    'attestation',
    'verify',
    file,
    '--repo',
    upstream,
    '--signer-workflow',
    `${upstream}/.github/workflows/release.yml`,
    '--source-ref',
    `refs/tags/v${version}`,
    '--source-digest',
    sha,
  ]);
  if (result.kind === 'missing') {
    if (policy === 'allow-unverified') return { kind: 'unverified' };
    throw new Error(
      `v${version} can't be verified: the GitHub CLI (gh) is not installed. Install it (https://cli.github.com) ` +
        'and run again, or pass --allow-unverified to install without checking where the file came from.',
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `v${version}: ${releaseAssetName(version)} failed its attestation check: not installed\n${result.output}`,
    );
  }
  return { kind: 'verified' };
}

/**
 * Downloads the release's signed asset into `dir`.
 *
 * @param {string} url
 * @param {string} dir An empty folder, which the caller removes.
 * @returns {Promise<string>} The downloaded file.
 */
export async function downloadAsset(url, dir) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${url}: ${response.status}`);
  const archive = join(dir, 'release.tgz');
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  return archive;
}

/**
 * Unpacks a release archive whose single top folder holds `server/`.
 *
 * @param {string} archive
 * @param {string} dir The folder to unpack into.
 * @returns {string} The unpacked `server/` folder.
 */
export function unpackRelease(archive, dir) {
  // A relative path: GNU tar reads the `C:` of a Windows path as a remote host.
  execFileSync('tar', ['-xzf', relative(dir, archive), '--strip-components=1'], { cwd: dir });
  const server = join(dir, 'server');
  if (!existsSync(join(server, 'package.json'))) throw new Error(`${archive} has no server/ folder`);
  return server;
}

/**
 * Downloads the release's signed asset, verifies it, and only then unpacks it.
 *
 * @param {ReleaseSource} source
 * @param {Release} release
 * @param {string} dir An empty folder, which the caller removes.
 * @param {VerifyPolicy} policy
 * @returns {Promise<string>} The unpacked `server/` folder.
 */
export async function fetchSignedRelease(source, release, dir, policy) {
  const archive = await source.download(await releaseAssetUrl(source.get, release), dir);
  const verification = verifyAttestation(source.run, archive, release, policy);
  if (verification.kind === 'unverified') {
    console.log(`::warning::v${release.version} installed without verifying its signature (--allow-unverified, no gh)`);
  }
  return unpackRelease(archive, dir);
}
